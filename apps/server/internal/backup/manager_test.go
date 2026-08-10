package backup

import (
	"context"
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
