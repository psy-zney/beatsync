package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/psy-zney/beatsync/apps/server/internal/config"
)

func TestLegacyClientCORSPreflight(t *testing.T) {
	application, err := New(testConfig(t))
	if err != nil {
		t.Fatal(err)
	}
	defer application.Shutdown(t.Context())
	request := httptest.NewRequest(http.MethodOptions, "/voice/token", nil)
	request.Header.Set("Origin", "https://beatsync.zney295.id.vn")
	request.Header.Set("Access-Control-Request-Headers", "content-type,bypass-tunnel-reminder,ngrok-skip-browser-warning")
	response := httptest.NewRecorder()
	application.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d", response.Code)
	}
	allowed := response.Header().Get("Access-Control-Allow-Headers")
	for _, name := range []string{"bypass-tunnel-reminder", "ngrok-skip-browser-warning"} {
		if !strings.Contains(strings.ToLower(allowed), name) {
			t.Fatalf("Access-Control-Allow-Headers %q is missing %q", allowed, name)
		}
	}
}

func testConfig(t *testing.T) config.Config {
	t.Helper()
	return config.Config{Host: "127.0.0.1", Port: 1001, DemoRoomID: "090624", StreamConcurrency: 1, StreamQueueSize: 2, MaxAudioDownloadBytes: 1 << 20, MemorySoftLimitBytes: 64 << 20, MemoryHardLimitBytes: 96 << 20, MemoryCheckInterval: time.Second, RoomIdleTTL: time.Minute, BackupInterval: time.Minute, HTTPTimeout: time.Second, ExtractorTimeout: time.Second, MaxConnectionsPerRoom: 10, MaxWebSocketMessageSize: 64 << 10, LocalBackupPath: t.TempDir() + "/state.json"}
}

func TestHealthAndAvatarWebSocketFlow(t *testing.T) {
	application, err := New(testConfig(t))
	if err != nil {
		t.Fatal(err)
	}
	defer application.Shutdown(t.Context())
	server := httptest.NewServer(application.Handler())
	defer server.Close()
	response, err := server.Client().Get(server.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("health status = %d", response.StatusCode)
	}

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws?roomId=090624&username=Alice&clientId=client_one"
	connection, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	_ = connection.SetReadDeadline(time.Now().Add(3 * time.Second))
	if err := connection.WriteJSON(map[string]any{"type": "UPDATE_PROFILE", "avatar": "🎧"}); err != nil {
		t.Fatal(err)
	}
	found := false
	for range 8 {
		_, payload, readErr := connection.ReadMessage()
		if readErr != nil {
			t.Fatal(readErr)
		}
		var message map[string]any
		if json.Unmarshal(payload, &message) != nil || message["type"] != "ROOM_EVENT" {
			continue
		}
		event, _ := message["event"].(map[string]any)
		if event["type"] != "CLIENT_CHANGE" {
			continue
		}
		clients, _ := event["clients"].([]any)
		for _, raw := range clients {
			client, _ := raw.(map[string]any)
			if client["clientId"] == "client_one" && client["avatar"] == "🎧" {
				found = true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		t.Fatal("avatar update was not broadcast")
	}
}
