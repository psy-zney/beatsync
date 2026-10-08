package app

import (
	"testing"
	"time"

	"context"
	"errors"
	"github.com/psy-zney/beatsync/apps/server/internal/model"
	"sync/atomic"
)

func TestSharedLyricsReachExistingAndLateJoiningClients(t *testing.T) {
	application, server := newWebSocketTestServer(t)
	first := dialTestRoomClient(t, server, "123456", "lyrics-first")
	readUntil(t, first, func(message map[string]any) bool { return message["type"] == "ROOM_JOINED" })
	state, _ := application.Rooms.Get("123456")
	state.AddAudioSource(model.AudioSource{URL: "/youtube/proxy?videoId=dQw4w9WgXcQ", Title: "Lyrics test"})
	second := dialTestRoomClient(t, server, "123456", "lyrics-second")
	readUntil(t, second, func(message map[string]any) bool { return message["type"] == "ROOM_JOINED" })
	lyrics := model.TrackLyrics{Synced: "[00:05]Hello\n[00:10]Next line", Provider: "import", Offset: 0.5}
	if err := first.WriteJSON(map[string]any{"type": "SET_TRACK_LYRICS", "audioSource": "/youtube/proxy?videoId=dQw4w9WgXcQ", "lyrics": lyrics}); err != nil {
		t.Fatal(err)
	}
	withLyrics := func(message map[string]any) bool {
		event, _ := message["event"].(map[string]any)
		if event["type"] == "TRACK_LYRICS_UPDATE" {
			data, _ := event["lyrics"].(map[string]any)
			return data["synced"] == lyrics.Synced && data["offset"] == lyrics.Offset
		}
		if event["type"] != "SET_AUDIO_SOURCES" {
			return false
		}
		sources, _ := event["sources"].([]any)
		if len(sources) != 1 {
			return false
		}
		source, _ := sources[0].(map[string]any)
		data, _ := source["lyrics"].(map[string]any)
		return data["synced"] == lyrics.Synced && data["offset"] == lyrics.Offset
	}
	readUntil(t, first, withLyrics)
	readUntil(t, second, withLyrics)
	late := dialTestRoomClient(t, server, "123456", "lyrics-late")
	readUntil(t, late, withLyrics)
	if err := first.WriteJSON(map[string]any{"type": "SET_TRACK_LYRICS", "audioSource": "/youtube/proxy?videoId=dQw4w9WgXcQ", "lyrics": map[string]any{"synced": "Bad", "plain": "", "offset": 31, "provider": "import"}}); err != nil {
		t.Fatal(err)
	}
	readUntil(t, first, func(message map[string]any) bool { return message["type"] == "ERROR" })
	sources, _, _, _, _, _, _ := state.State()
	if sources[0].Lyrics.Offset != 0.5 {
		t.Fatal("invalid request changed lyrics")
	}
}

func TestAutomaticLyricsArriveWithoutDialogAndCanRetry(t *testing.T) {
	application, server := newWebSocketTestServer(t)
	var calls atomic.Int32
	application.Lyrics.SetYouTubeFetcher(func(ctx context.Context, id string) (model.YouTubeLyricsResult, error) {
		if calls.Add(1) == 1 {
			return model.YouTubeLyricsResult{}, errors.New("temporary provider error")
		}
		return model.YouTubeLyricsResult{Lyrics: &model.TrackLyrics{Synced: "[00:01]Xin chào Việt Nam\n[00:05]Câu tiếp theo", Provider: "youtube-manual", Language: "vi", SyncType: "line"}}, nil
	})
	first := dialTestRoomClient(t, server, "556677", "auto-first")
	readUntil(t, first, func(message map[string]any) bool { return message["type"] == "ROOM_JOINED" })
	sourceURL := "/youtube/proxy?videoId=abcdefghijk"
	if err := first.WriteJSON(map[string]any{"type": "IMPORT_PLAYLIST", "sources": []model.AudioSource{{URL: sourceURL}}}); err != nil {
		t.Fatal(err)
	}
	withStatus := func(status string) func(map[string]any) bool {
		return func(message map[string]any) bool {
			event, _ := message["event"].(map[string]any)
			if event["type"] == "TRACK_LYRICS_UPDATE" {
				return event["lyricsState"] == status
			}
			sources, _ := event["sources"].([]any)
			if event["type"] != "SET_AUDIO_SOURCES" || len(sources) != 1 {
				return false
			}
			source, _ := sources[0].(map[string]any)
			return source["lyricsState"] == status
		}
	}
	readUntil(t, first, withStatus("error"))
	second := dialTestRoomClient(t, server, "556677", "auto-second")
	readUntil(t, second, func(message map[string]any) bool { return message["type"] == "ROOM_JOINED" })
	if err := first.WriteJSON(map[string]any{"type": "RETRY_TRACK_LYRICS", "audioSource": sourceURL}); err != nil {
		t.Fatal(err)
	}
	readUntil(t, first, withStatus("ready"))
	readUntil(t, second, withStatus("ready"))
	late := dialTestRoomClient(t, server, "556677", "auto-late")
	readUntil(t, late, withStatus("ready"))
	if calls.Load() != 2 {
		t.Fatalf("fetches=%d", calls.Load())
	}
}

func TestExtractVideoID(t *testing.T) {
	cases := []struct {
		url      string
		expected string
	}{
		{"/youtube/proxy?videoId=dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"http://localhost:1001/youtube/proxy?videoId=dQw4w9WgXcQ&other=1", "dQw4w9WgXcQ"},
		{"https://r2.example.com/youtube-cache/dQw4w9WgXcQ.webm", "dQw4w9WgXcQ"},
		{"https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://storage.example.com/room-123456/song.mp3", ""},
		{"", ""},
	}

	for _, c := range cases {
		got := extractVideoID(c.url)
		if got != c.expected {
			t.Errorf("extractVideoID(%q) = %q, want %q", c.url, got, c.expected)
		}
	}
}

func TestAutoLyricsPriorityAndNoOverwrite(t *testing.T) {
	application, _ := newWebSocketTestServer(t)
	roomID := "998877"
	state := application.Rooms.GetOrCreate(roomID)

	// Pre-populate lyrics service cache for track 1
	manualLyrics := &model.TrackLyrics{
		Synced:   "[00:01]Manual\n[00:05]Lyrics",
		Provider: "user",
		SyncType: "line",
	}
	cachedLyrics := &model.TrackLyrics{
		Synced:   "[00:02]Cached\n[00:06]Song",
		Provider: "youtube-manual",
		Language: "vi",
		SyncType: "line",
	}

	url1 := "/youtube/proxy?videoId=track111111"
	url2 := "/youtube/proxy?videoId=track222222"

	// Track 1 already has manual lyrics
	state.AddAudioSource(model.AudioSource{URL: url1, Title: "Track One", Lyrics: manualLyrics})
	// Track 2 has no lyrics
	state.AddAudioSource(model.AudioSource{URL: url2, Title: "Track Two"})

	// Preload cache for track 2 in application.Lyrics
	application.Lyrics.StoreManually(url2, cachedLyrics)

	// Trigger auto lyrics
	application.triggerAutoLyrics(roomID, state)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		current, _, _, _, _, _, _ := state.State()
		if current[1].Lyrics != nil {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}

	sources, _, _, _, _, _, _ := state.State()
	if len(sources) != 2 {
		t.Fatalf("expected 2 sources, got %d", len(sources))
	}

	// Verify track 1 manual lyrics were NOT overwritten
	if sources[0].Lyrics == nil || sources[0].Lyrics.Provider != "user" || sources[0].Lyrics.Synced != manualLyrics.Synced {
		t.Fatalf("track 1 manual lyrics were unexpectedly overwritten: %+v", sources[0].Lyrics)
	}

	// Verify track 2 received cached lyrics
	if sources[1].Lyrics == nil || sources[1].Lyrics.Provider != "youtube-manual" || sources[1].Lyrics.Synced != cachedLyrics.Synced {
		t.Fatalf("track 2 did not receive auto lyrics: %+v", sources[1].Lyrics)
	}
	if sources[1].LyricsState != "ready" {
		t.Fatalf("track 2 state = %q, want 'ready'", sources[1].LyricsState)
	}
}
