package room

import (
	"github.com/psy-zney/beatsync/apps/server/internal/model"
	"strings"
	"testing"
	"time"
)

func TestLyricsJobCannotOverwriteManualOrReaddedTrack(t *testing.T) {
	state := New("123456")
	state.AddAudioSource(model.AudioSource{URL: "track"})
	now := time.Now()
	_, token, ok := state.BeginLyricsFetch("track", now)
	if !ok {
		t.Fatal("job not started")
	}
	manual := &model.TrackLyrics{Synced: "[00:01]Manual", Provider: "import"}
	state.SetTrackLyrics("track", manual, false)
	if _, ok := state.FinishLyricsFetch("track", token, &model.TrackLyrics{Synced: "[00:01]Automatic", Provider: "lrclib"}, "ready", now); ok {
		t.Fatal("late job overwrote manual lyrics")
	}
	state.SetTrackLyrics("track", nil, false)
	_, token, _ = state.BeginLyricsFetch("track", now)
	state.RemoveAudioSources(map[string]bool{"track": true})
	state.AddAudioSource(model.AudioSource{URL: "track"})
	if _, ok := state.FinishLyricsFetch("track", token, manual, "ready", now); ok {
		t.Fatal("old job applied to a readded track")
	}
}

func TestLyricsErrorsAlwaysExitFetchingAndRetry(t *testing.T) {
	state := New("123456")
	state.AddAudioSource(model.AudioSource{URL: "track"})
	now := time.Now()
	_, token, _ := state.BeginLyricsFetch("track", now)
	sources, ok := state.FinishLyricsFetch("track", token, &model.TrackLyrics{Synced: strings.Repeat("a", 40001), Provider: "lrclib"}, "ready", now)
	if !ok || sources[0].LyricsState != "error" {
		t.Fatal("invalid result left a stuck job")
	}
	if _, _, ok := state.BeginLyricsFetch("track", now.Add(time.Second)); ok {
		t.Fatal("backoff ignored")
	}
	_, token, ok = state.BeginLyricsFetch("track", now.Add(11*time.Second))
	if !ok {
		t.Fatal("error did not become retryable")
	}
	sources, ok = state.FinishLyricsFetch("track", token, nil, "not_found", now)
	if !ok || sources[0].LyricsState != "not_found" {
		t.Fatal("missing not recorded")
	}
	if _, _, ok = state.BeginLyricsFetch("track", now.Add(16*time.Minute)); !ok {
		t.Fatal("missing never retried after TTL")
	}
}

func TestRestoreRestartsTransientLyricsAndPendingTrackPriority(t *testing.T) {
	state := New("123456")
	state.AddAudioSource(model.AudioSource{URL: "first", LyricsState: "fetching"})
	for _, url := range []string{"second", "third", "fourth", "fifth"} {
		state.AddAudioSource(model.AudioSource{URL: url})
	}
	state.BeginPlay(map[string]any{"audioSource": "fourth"}, "tester")
	candidates := state.LyricsCandidates()
	if len(candidates) != 3 || candidates[0].URL != "fourth" || candidates[1].URL != "fifth" || candidates[2].URL != "first" {
		t.Fatalf("priority=%+v", candidates)
	}
	restored := New("123456")
	restored.Restore(state.Snapshot())
	if _, _, ok := restored.BeginLyricsFetch("first", time.Now()); !ok {
		t.Fatal("restored fetching never restarted")
	}
}

func TestStructuredLyricsAreCopiedAndValidated(t *testing.T) {
	state := New("123456")
	state.AddAudioSource(model.AudioSource{URL: "track"})
	value := &model.TrackLyrics{Provider: "youtube-manual", SyncType: "word", Language: "vi", Lines: []model.LyricLine{{StartTime: 1, EndTime: 3, Text: "Xin chào", Words: []model.LyricWord{{StartTime: 1, EndTime: 2, Text: "Xin "}, {StartTime: 2, EndTime: 3, Text: "chào"}}}}}
	state.SetTrackLyrics("track", value, false)
	value.Lines[0].Words[0].Text = "changed"
	sources, _, _, _, _, _, _ := state.State()
	if sources[0].Lyrics.Lines[0].Words[0].Text != "Xin " {
		t.Fatal("room holds caller's mutable timing slices")
	}
	bad := model.CloneTrackLyrics(sources[0].Lyrics)
	bad.Lines[0].Words[0].EndTime = 10
	if ValidLyrics(bad) {
		t.Fatal("word outside cue accepted")
	}
}

func TestLegacyAutomaticLyricsRefreshButManualImportsSurvive(t *testing.T) {
	state := New("123456")
	old := &model.TrackLyrics{Synced: "[00:01]Wrong translated lyrics", Provider: "youtube-auto", Language: "vi"}
	state.AddAudioSource(model.AudioSource{URL: "old", Lyrics: old})
	manual := &model.TrackLyrics{Synced: "[00:01]Lời người dùng", Provider: "import"}
	state.AddAudioSource(model.AudioSource{URL: "manual", Lyrics: manual})
	current := &model.TrackLyrics{Synced: "[00:01]Lời gốc", Provider: "youtube-manual", Language: "vi", ResolverVersion: model.LyricsResolverVersion, Automatic: true}
	state.AddAudioSource(model.AudioSource{URL: "current", Lyrics: current})
	restored := New("123456")
	restored.Restore(state.Snapshot())
	sources, _, _, _, _, _, _ := restored.State()
	if sources[0].Lyrics != nil || sources[1].Lyrics == nil || sources[2].Lyrics == nil {
		t.Fatal("migration lost manual/current lyrics or kept legacy automatic lyrics")
	}
}

func TestPausedLyricSeekUpdatesSharedPlaybackPosition(t *testing.T) {
	state := New("123456")
	state.AddAudioSource(model.AudioSource{URL: "track"})
	if _, ok := state.Pause(map[string]any{"type": "PAUSE", "audioSource": "track", "trackTimeSeconds": 6.5}); !ok {
		t.Fatal("paused seek rejected")
	}
	_, playback, _, _, _, _, _ := state.State()
	if playback.Type != "paused" || playback.AudioSource != "track" || playback.TrackPositionSeconds != 6.5 {
		t.Fatalf("shared position=%+v", playback)
	}
}

func TestLegacyLRCLIBIsRefetchedAndManualCorrectionsArePreserved(t *testing.T) {
	state := New("123456")
	state.AddAudioSource(model.AudioSource{URL: "legacy", Lyrics: &model.TrackLyrics{Plain: "Lyrics for another song", Provider: "lrclib"}})
	state.AddAudioSource(model.AudioSource{URL: "edited", Lyrics: &model.TrackLyrics{Synced: "[00:01]Lời đã sửa", Offset: -0.1, Provider: "lrclib", ResolverVersion: 4, Automatic: false}})
	sources, _, _, _, _, _, _ := state.State()
	if sources[0].Lyrics != nil || sources[1].Lyrics == nil || sources[1].Lyrics.Offset != -0.1 {
		t.Fatal("legacy catalog lyrics remained, or explicit corrections were lost")
	}
}
