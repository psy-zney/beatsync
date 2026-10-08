package room

import (
	"math"
	"strings"
	"testing"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

func TestTrackLyricsSurviveReorderTitleHealingAndBackup(t *testing.T) {
	r := New("123456")
	r.AddAudioSource(model.AudioSource{URL: "first", Title: "First"})
	r.AddAudioSource(model.AudioSource{URL: "second", Title: "Second"})
	lyrics := &model.TrackLyrics{Synced: "[00:05]Hello", Provider: "import", Offset: 0.5}
	if _, err := r.SetTrackLyrics("first", lyrics, false); err != nil {
		t.Fatal(err)
	}
	lyrics.Offset = 20 // callers cannot mutate the room's metadata
	sources, ok := r.ReorderAudioSources([]model.AudioSource{{URL: "second"}, {URL: "first"}})
	if !ok || sources[1].Title != "First" || sources[1].Lyrics.Offset != 0.5 {
		t.Fatalf("reordered sources = %#v", sources)
	}
	r.AddAudioSource(model.AudioSource{URL: "first", Title: "Healed title"})
	restored := New("123456")
	restored.Restore(r.Snapshot())
	sources, _, _, _, _, _, _ = restored.State()
	if sources[1].Lyrics == nil || sources[1].Lyrics.Synced != "[00:05]Hello" {
		t.Fatalf("backup lost lyrics: %#v", sources)
	}
	if _, ok := r.ReorderAudioSources([]model.AudioSource{{URL: "first"}, {URL: "first"}}); ok {
		t.Fatal("duplicate reorder accepted")
	}
}

func TestAutomaticLyricsDoNotOverwriteManualSelection(t *testing.T) {
	r := New("123456")
	r.AddAudioSource(model.AudioSource{URL: "track"})
	manual := &model.TrackLyrics{Synced: "[00:10]Manual", Provider: "import"}
	r.SetTrackLyrics("track", manual, false)
	automatic := &model.TrackLyrics{Synced: "[00:05]Automatic", Provider: "lrclib"}
	if sources, err := r.SetTrackLyrics("track", automatic, true); err != nil || sources != nil {
		t.Fatalf("automatic overwrite: %v %v", sources, err)
	}
	if _, err := r.SetTrackLyrics("missing", manual, false); err == nil {
		t.Fatal("missing source accepted")
	}
	sources, err := r.SetTrackLyrics("track", nil, false)
	if err != nil || sources[0].Lyrics != nil {
		t.Fatal("lyrics removal failed")
	}
}

func TestTrackLyricsValidation(t *testing.T) {
	for _, lyrics := range []*model.TrackLyrics{
		{Synced: strings.Repeat("🎵", 10_001), Provider: "import"},
		{Offset: math.NaN(), Provider: "import"},
		{Offset: math.Inf(1), Provider: "import"},
		{Offset: 31, Provider: "import"},
		{Provider: "unknown"},
	} {
		if ValidLyrics(lyrics) {
			t.Fatalf("invalid lyrics accepted: offset=%v provider=%s", lyrics.Offset, lyrics.Provider)
		}
	}
}
