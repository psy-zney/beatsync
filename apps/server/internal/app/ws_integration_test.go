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
	return dialTestRoomClient(t, server, "090624", clientID)
}

func dialTestRoomClient(t *testing.T, server *httptest.Server, roomID, clientID string) *websocket.Conn {
	t.Helper()
	endpoint := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws?roomId=" + roomID + "&username=Tester&clientId=" + clientID
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

func TestMultipleRoomsKeepPlaylistsSeparateAndReportNewRoom(t *testing.T) {
	t.Parallel()
	application, server := newWebSocketTestServer(t)
	first := dialTestRoomClient(t, server, "123456", "first-room-client")
	joined := readUntil(t, first, func(message map[string]any) bool { return message["type"] == "ROOM_JOINED" })
	if joined["isNewRoom"] != true {
		t.Fatalf("first room join = %#v", joined)
	}
	if err := first.WriteJSON(map[string]any{"type": "IMPORT_PLAYLIST", "sources": []model.AudioSource{
		{URL: "/youtube/proxy?videoId=dQw4w9WgXcQ", Title: "Saved track"},
		{URL: "javascript:alert(1)", Title: "Invalid"},
		{URL: "https://untrusted.test/track.mp3", Title: "Invalid host"},
		{URL: "/youtube/proxy?videoId=dQw4w9WgXcQ", Title: "Saved track"},
	}}); err != nil {
		t.Fatal(err)
	}
	readUntil(t, first, func(message map[string]any) bool {
		event, _ := message["event"].(map[string]any)
		return event["type"] == "SET_AUDIO_SOURCES"
	})
	state, _ := application.Rooms.Get("123456")
	sources, _, _, _, _, _, _ := state.State()
	if len(sources) != 1 || sources[0].Title != "Saved track" {
		t.Fatalf("imported sources = %#v", sources)
	}
	second := dialTestRoomClient(t, server, "654321", "second-room-client")
	joined = readUntil(t, second, func(message map[string]any) bool { return message["type"] == "ROOM_JOINED" })
	if joined["isNewRoom"] != true {
		t.Fatalf("second room join = %#v", joined)
	}
	secondState, _ := application.Rooms.Get("654321")
	secondSources, _, _, _, _, _, _ := secondState.State()
	if len(secondSources) != 0 {
		t.Fatalf("sources leaked to second room: %#v", secondSources)
	}
	late := dialTestRoomClient(t, server, "123456", "late-room-client")
	joined = readUntil(t, late, func(message map[string]any) bool { return message["type"] == "ROOM_JOINED" })
	if joined["isNewRoom"] != false {
		t.Fatalf("existing room must not suggest an import: %#v", joined)
	}
	if err := first.WriteJSON(map[string]any{"type": "SAVE_PLAYLIST"}); err != nil {
		t.Fatal(err)
	}
	save := readUntil(t, first, func(message map[string]any) bool { return message["type"] == "SAVE_PLAYLIST_RESPONSE" })
	if save["success"] != false {
		t.Fatalf("normal room must not save to object storage: %#v", save)
	}
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
