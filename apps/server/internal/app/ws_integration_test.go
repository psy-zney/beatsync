package app

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

func newWebSocketTestServer(t *testing.T) (*App, *httptest.Server) {
	t.Helper()
	application, err := New(testConfig(t))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(application.Handler())
	t.Cleanup(func() {
		server.Close()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		application.Shutdown(shutdownCtx)
	})
	return application, server
}

func dialTestClient(t *testing.T, server *httptest.Server, clientID string) *websocket.Conn {
	t.Helper()
	endpoint := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws?roomId=090624&username=Tester&clientId=" + clientID
	connection, response, err := websocket.DefaultDialer.Dial(endpoint, nil)
	if err != nil {
		status := 0
		if response != nil {
			status = response.StatusCode
		}
		t.Fatalf("dial WebSocket: status=%d err=%v", status, err)
	}
	t.Cleanup(func() { connection.Close() })
	_ = connection.SetReadDeadline(time.Now().Add(5 * time.Second))
	return connection
}

func readUntil(t *testing.T, connection *websocket.Conn, match func(map[string]any) bool) map[string]any {
	t.Helper()
	for {
		_, payload, err := connection.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		var message map[string]any
		if json.Unmarshal(payload, &message) == nil && match(message) {
			return message
		}
	}
}

func TestWebSocketBurstDoesNotDisconnectHealthyClient(t *testing.T) {
	t.Parallel()
	_, server := newWebSocketTestServer(t)
	connection := dialTestClient(t, server, "burst-client")

	const messages = 40
	for index := 0; index < messages; index++ {
		if err := connection.WriteJSON(map[string]any{"type": "UNKNOWN_BURST_MESSAGE", "index": index}); err != nil {
			t.Fatalf("write %d: %v", index, err)
		}
	}
	responses := 0
	for responses < messages {
		readUntil(t, connection, func(message map[string]any) bool {
			if message["type"] == "ERROR" {
				responses++
				return true
			}
			return false
		})
	}
	if err := connection.WriteJSON(map[string]any{"type": "NTP_REQUEST", "t0": 123, "probeGroupId": 9, "probeGroupIndex": 0}); err != nil {
		t.Fatalf("connection did not survive burst: %v", err)
	}
	response := readUntil(t, connection, func(message map[string]any) bool { return message["type"] == "NTP_RESPONSE" })
	if response["t0"] != float64(123) {
		t.Fatalf("NTP response=%#v", response)
	}
}

func TestPendingPlayTimeoutUsesDeterministicScheduler(t *testing.T) {
	t.Parallel()
	application, server := newWebSocketTestServer(t)
	callbacks := make(chan func(), 1)
	application.schedule = func(delay time.Duration, callback func()) {
		if delay != 3*time.Second {
			t.Errorf("schedule delay=%s, want 3s", delay)
		}
		callbacks <- callback
	}
	source := model.AudioSource{URL: "https://audio.test/worker.mp3", Title: "Worker track"}
	application.Rooms.GetOrCreate("090624").AddAudioSource(source)
	connection := dialTestClient(t, server, "timer-client")

	if err := connection.WriteJSON(map[string]any{"type": "PLAY", "audioSource": source.URL, "trackTimeSeconds": 8.25}); err != nil {
		t.Fatal(err)
	}
	readUntil(t, connection, func(message map[string]any) bool {
		if message["type"] != "ROOM_EVENT" {
			return false
		}
		event, _ := message["event"].(map[string]any)
		return event["type"] == "LOAD_AUDIO_SOURCE"
	})

	select {
	case callback := <-callbacks:
		callback()
	case <-time.After(3 * time.Second):
		t.Fatal("play timeout was not scheduled")
	}
	message := readUntil(t, connection, func(message map[string]any) bool {
		if message["type"] != "SCHEDULED_ACTION" {
			return false
		}
		action, _ := message["scheduledAction"].(map[string]any)
		return action["type"] == "PLAY" && action["trackTimeSeconds"] == 8.25
	})
	if message["serverTimeToExecute"].(float64) <= 0 {
		t.Fatalf("scheduled message=%#v", message)
	}
}
