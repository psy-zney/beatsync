package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
	"github.com/psy-zney/beatsync/apps/server/internal/room"
	"github.com/psy-zney/beatsync/apps/server/internal/storage"
)

func TestOnlyReservedRoomSavesAndRestoresRemotePlaylist(t *testing.T) {
	var methods []string
	var saved []model.AudioSource
	var mu sync.Mutex
	readMethods := func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), methods...)
	}
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		methods = append(methods, r.Method)
		if r.URL.Path != "/test-bucket/room-090624/playlist.json" {
			t.Errorf("unexpected object key: %s", r.URL.Path)
		}
		if r.Method == http.MethodPut {
			if err := json.NewDecoder(r.Body).Decode(&saved); err != nil {
				t.Error(err)
			}
		} else {
			json.NewEncoder(w).Encode(saved)
		}
	}))
	defer endpoint.Close()
	cfg := testConfig(t)
	cfg.S3Endpoint, cfg.S3Bucket, cfg.S3PublicURL = endpoint.URL, "test-bucket", "https://cdn.test"
	cfg.S3AccessKey, cfg.S3SecretKey, cfg.S3Region = "test", "test", "auto"
	store, err := storage.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	application := &App{Config: cfg, Store: store}
	normal := room.New("123456")
	normal.AddAudioSource(model.AudioSource{URL: "https://cdn.test/normal.mp3"})
	if err := application.savePlaylist(context.Background(), normal); err != nil {
		t.Fatal(err)
	}
	application.loadPlaylist(context.Background(), room.New("654321"))
	if calls := readMethods(); len(calls) != 0 {
		t.Fatalf("normal rooms accessed object storage: %#v", calls)
	}
	reserved := room.New(persistentRoomID)
	reserved.AddAudioSource(model.AudioSource{URL: "https://cdn.test/reserved.mp3", Title: "Reserved playlist"})
	if err := application.savePlaylist(context.Background(), reserved); err != nil {
		t.Fatal(err)
	}
	restored := room.New(persistentRoomID)
	application.loadPlaylist(context.Background(), restored)
	sources, _, _, _, _, _, _ := restored.State()
	if calls := readMethods(); len(calls) != 2 || calls[0] != http.MethodPut || calls[1] != http.MethodGet || len(sources) != 1 || sources[0].Title != "Reserved playlist" {
		t.Fatalf("reserved room methods=%#v sources=%#v", calls, sources)
	}
}

func TestSavedYouTubeReferenceReusesExistingCacheWithoutWriting(t *testing.T) {
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodHead {
			t.Errorf("proxy cache lookup must not write or download audio: %s", r.Method)
		}
		if r.URL.Path == "/test-bucket/youtube-cache/dQw4w9WgXcQ.webm" {
			w.WriteHeader(http.StatusOK)
		} else {
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer endpoint.Close()
	cfg := testConfig(t)
	cfg.S3Endpoint, cfg.S3Bucket, cfg.S3PublicURL = endpoint.URL, "test-bucket", "https://cdn.test"
	cfg.S3AccessKey, cfg.S3SecretKey, cfg.S3Region = "test", "test", "auto"
	store, err := storage.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	application := &App{Config: cfg, Store: store}
	response := httptest.NewRecorder()
	application.handleYouTubeProxy(response, httptest.NewRequest(http.MethodGet, "/youtube/proxy?videoId=dQw4w9WgXcQ", nil))
	if response.Code != http.StatusTemporaryRedirect || response.Header().Get("Location") != "https://cdn.test/youtube-cache/dQw4w9WgXcQ.webm" {
		t.Fatalf("cache redirect: status=%d location=%s", response.Code, response.Header().Get("Location"))
	}
}
