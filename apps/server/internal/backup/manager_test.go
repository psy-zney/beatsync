package backup

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
	"github.com/psy-zney/beatsync/apps/server/internal/room"
)

func TestLocalBackupRoundTrip(t *testing.T) {
	directory := t.TempDir()
	rooms := room.NewManager()
	state := rooms.GetOrCreate("090624")
	state.AddAudioSource(model.AudioSource{URL: "https://audio.test/a.mp3", Title: "A"})
	manager := New(rooms, nil, filepath.Join(directory, "state.json"))
	if err := manager.SaveLocal(); err != nil {
		t.Fatal(err)
	}
	restoredRooms := room.NewManager()
	restorer := New(restoredRooms, nil, filepath.Join(directory, "state.json"))
	ok, err := restorer.Restore(context.Background())
	if err != nil || !ok {
		t.Fatalf("restore ok=%v err=%v", ok, err)
	}
	restored, _ := restoredRooms.Get("090624")
	sources, _, _, _, _, _, _ := restored.State()
	if len(sources) != 1 || sources[0].Title != "A" {
		t.Fatalf("restored sources = %+v", sources)
	}
}

func TestRestoreMissingBackupIsANoOp(t *testing.T) {
	t.Parallel()
	rooms := room.NewManager()
	ok, err := New(rooms, nil, filepath.Join(t.TempDir(), "missing.json")).Restore(t.Context())
	if err != nil || ok || rooms.Count() != 0 {
		t.Fatalf("restore ok=%v err=%v rooms=%d", ok, err, rooms.Count())
	}
}

func TestRestoreRejectsMalformedAndStructurallyInvalidBackups(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		data string
	}{
		{name: "malformed JSON", data: `{"timestamp":`},
		{name: "zero timestamp", data: `{"timestamp":0,"data":{"rooms":{}}}`},
		{name: "missing rooms", data: `{"timestamp":1,"data":{}}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "state.json")
			if err := os.WriteFile(path, []byte(test.data), 0o600); err != nil {
				t.Fatal(err)
			}
			rooms := room.NewManager()
			rooms.GetOrCreate("existing")
			ok, err := New(rooms, nil, path).Restore(t.Context())
			if err == nil || ok {
				t.Fatalf("restore ok=%v err=%v, want false and an error", ok, err)
			}
			if _, exists := rooms.Get("existing"); !exists {
				t.Fatal("failed restore mutated live rooms")
			}
		})
	}
}

func TestLocalBackupPreservesMultipleRoomsPlaybackAndCachedClients(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "nested", "state.json")
	rooms := room.NewManager()
	first := rooms.GetOrCreate("first")
	first.AddAudioSource(model.AudioSource{URL: "https://audio.test/a.mp3", Title: "A"})
	first.SetGlobalVolume(0.35)
	first.SetLowPass(1234)
	if _, ok := first.PlayImmediate(map[string]any{"audioSource": "https://audio.test/a.mp3", "trackTimeSeconds": 7.5}); !ok {
		t.Fatal("could not prepare playback state")
	}
	if _, err := first.AddClient(model.Client{ClientID: "cached", Username: "Alice", Avatar: "A", JoinedAt: 10}); err != nil {
		t.Fatal(err)
	}
	first.RemoveClient("cached")
	rooms.GetOrCreate("second").AddAudioSource(model.AudioSource{URL: "https://audio.test/b.mp3", Title: "B"})

	manager := New(rooms, nil, path)
	if err := manager.SaveLocal(); err != nil {
		t.Fatal(err)
	}
	// A second save exercises atomic replacement, not just first-file creation.
	if err := manager.SaveLocal(); err != nil {
		t.Fatal(err)
	}
	matches, err := filepath.Glob(filepath.Join(filepath.Dir(path), ".state-backup-*.tmp"))
	if err != nil || len(matches) != 0 {
		t.Fatalf("temporary backups=%v err=%v", matches, err)
	}

	restoredRooms := room.NewManager()
	ok, err := New(restoredRooms, nil, path).Restore(context.Background())
	if err != nil || !ok || restoredRooms.Count() != 2 {
		t.Fatalf("restore ok=%v err=%v rooms=%d", ok, err, restoredRooms.Count())
	}
	restored, exists := restoredRooms.Get("first")
	if !exists {
		t.Fatal("first room was not restored")
	}
	sources, playback, volume, lowPass, _, _, _ := restored.State()
	if len(sources) != 1 || sources[0].Title != "A" || playback.Type != "playing" || playback.TrackPositionSeconds != 7.5 || volume != 0.35 || lowPass != 1234 {
		t.Fatalf("restored state: sources=%+v playback=%+v volume=%v lowPass=%v", sources, playback, volume, lowPass)
	}
	if restored.ConnectionCount() != 0 {
		t.Fatalf("restored live connections=%d, want 0", restored.ConnectionCount())
	}
	if cached, exists := restored.Client("cached"); !exists || cached.Avatar != "A" {
		t.Fatalf("cached client=%+v exists=%v", cached, exists)
	}
}
