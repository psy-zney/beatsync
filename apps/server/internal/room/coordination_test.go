package room

import (
	"testing"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

const testAudioURL = "https://audio.test/one.mp3"

func addTestClients(t *testing.T, state *Room, ids ...string) {
	t.Helper()
	for _, id := range ids {
		if _, err := state.AddClient(model.Client{ClientID: id, Username: id, JoinedAt: 1}); err != nil {
			t.Fatalf("add client %q: %v", id, err)
		}
	}
}

func TestAudioLoadingWaitsForEveryConnectedClient(t *testing.T) {
	t.Parallel()
	state := New("090624")
	state.AddAudioSource(model.AudioSource{URL: testAudioURL, Title: "One"})
	addTestClients(t, state, "one", "two", "three", "four")

	action := map[string]any{"type": "PLAY", "audioSource": testAudioURL, "trackTimeSeconds": 42.5}
	token, source, ok := state.BeginPlay(action, "one")
	if !ok || token == 0 || source.URL != testAudioURL {
		t.Fatalf("begin play = token %d, source %+v, ok %v", token, source, ok)
	}
	if _, _, ok := state.ExecutePending(token); ok {
		t.Fatal("executed before anyone loaded")
	}

	tests := []struct {
		client string
		source string
		ready  bool
	}{
		{client: "two", source: "wrong", ready: false},
		{client: "two", source: testAudioURL, ready: false},
		{client: "two", source: testAudioURL, ready: false}, // duplicate is harmless
		{client: "three", source: testAudioURL, ready: false},
		{client: "four", source: testAudioURL, ready: false},
		{client: "one", source: testAudioURL, ready: true},
	}
	for _, test := range tests {
		gotToken, ready := state.MarkAudioLoaded(test.client, test.source)
		if ready != test.ready {
			t.Fatalf("loaded(%q, %q) ready=%v, want %v", test.client, test.source, ready, test.ready)
		}
		if test.source == testAudioURL && gotToken != token {
			t.Fatalf("loaded(%q) token=%d, want %d", test.client, gotToken, token)
		}
	}

	executed, executeAt, ok := state.ExecutePending(token)
	if !ok || executeAt <= 0 || executed["trackTimeSeconds"] != 42.5 {
		t.Fatalf("execute = action %#v, at %f, ok %v", executed, executeAt, ok)
	}
	if _, _, ok := state.ExecutePending(token); ok {
		t.Fatal("pending play executed twice")
	}
	_, playback, _, _, _, _, _ := state.State()
	if playback.Type != "playing" || playback.AudioSource != testAudioURL || playback.TrackPositionSeconds != 42.5 {
		t.Fatalf("playback = %+v", playback)
	}
}

func TestNewPlayInvalidatesOldTokenAndRemovedSourceCannotPlay(t *testing.T) {
	t.Parallel()
	state := New("090624")
	secondURL := "https://audio.test/two.mp3"
	state.SetAudioSources([]model.AudioSource{{URL: testAudioURL}, {URL: secondURL}})
	addTestClients(t, state, "one")

	oldToken, _, ok := state.BeginPlay(map[string]any{"audioSource": testAudioURL}, "one")
	if !ok {
		t.Fatal("first play was rejected")
	}
	newToken, _, ok := state.BeginPlay(map[string]any{"audioSource": secondURL}, "one")
	if !ok || newToken <= oldToken {
		t.Fatalf("replacement token=%d, old=%d, ok=%v", newToken, oldToken, ok)
	}
	if _, _, ok := state.ExecutePending(oldToken); ok {
		t.Fatal("superseded token executed")
	}
	state.MarkAudioLoaded("one", secondURL)
	state.RemoveAudioSources(map[string]bool{secondURL: true})
	if _, _, ok := state.ExecutePending(newToken); ok {
		t.Fatal("removed source executed")
	}
	_, playback, _, _, _, _, _ := state.State()
	if playback.Type != "paused" {
		t.Fatalf("playback=%+v, want paused", playback)
	}
}

func TestDisconnectCanCompletePendingLoadButEmptyRoomCannot(t *testing.T) {
	t.Parallel()
	state := New("090624")
	state.AddAudioSource(model.AudioSource{URL: testAudioURL})
	addTestClients(t, state, "one", "two", "three", "slow")
	token, _, ok := state.BeginPlay(map[string]any{"audioSource": testAudioURL}, "one")
	if !ok {
		t.Fatal("play was rejected")
	}
	state.MarkAudioLoaded("two", testAudioURL)
	state.MarkAudioLoaded("three", testAudioURL)
	state.MarkAudioLoaded("one", testAudioURL)
	state.RemoveClient("slow")
	if readyToken, ready := state.PendingReady(); !ready || readyToken != token {
		t.Fatalf("pending ready = token %d, ready %v; want %d, true", readyToken, ready, token)
	}

	empty := New("090624")
	empty.AddAudioSource(model.AudioSource{URL: testAudioURL})
	addTestClients(t, empty, "only")
	empty.BeginPlay(map[string]any{"audioSource": testAudioURL}, "only")
	empty.RemoveClient("only")
	if _, ready := empty.PendingReady(); ready {
		t.Fatal("empty room became ready to play")
	}
}

func TestJoiningClientBlocksExecutionAfterReadyCheck(t *testing.T) {
	state := New("090624")
	state.AddAudioSource(model.AudioSource{URL: testAudioURL})
	addTestClients(t, state, "one")
	token, _, _ := state.BeginPlay(map[string]any{"audioSource": testAudioURL}, "one")
	if _, ready := state.MarkAudioLoaded("one", testAudioURL); !ready {
		t.Fatal("single loaded client should be ready")
	}
	addTestClients(t, state, "late")
	if _, _, ok := state.ExecutePending(token); ok {
		t.Fatal("executed while joining client was loading")
	}
	state.MarkAudioLoaded("late", testAudioURL)
	if _, _, ok := state.ExecutePending(token); !ok {
		t.Fatal("did not execute after joining client loaded")
	}
}

func TestAutomaticContinuationWaitsAndIgnoresDuplicateEndEvents(t *testing.T) {
	state := New("090624")
	const nextURL = "https://audio.test/next.mp3"
	state.SetAudioSources([]model.AudioSource{{URL: testAudioURL}, {URL: nextURL}})
	addTestClients(t, state, "one", "slow")
	state.PlayImmediate(map[string]any{"audioSource": testAudioURL})
	action := map[string]any{"audioSource": nextURL, "trackTimeSeconds": float64(0), "previousAudioSource": testAudioURL}
	token, _, ok := state.BeginPlay(action, "one")
	if !ok {
		t.Fatal("automatic continuation was rejected")
	}
	state.MarkAudioLoaded("one", nextURL)
	if _, _, ok := state.BeginPlay(action, "slow"); ok {
		t.Fatal("duplicate end event reset the load barrier")
	}
	if _, _, ok := state.ExecutePending(token); ok {
		t.Fatal("started before slow client loaded")
	}
	if _, ready := state.MarkAudioLoaded("slow", nextURL); !ready {
		t.Fatal("duplicate end event discarded earlier load acknowledgement")
	}
	if _, _, ok := state.ExecutePending(token); !ok {
		t.Fatal("automatic continuation did not execute")
	}
	_, playback, _, _, _, _, _ := state.State()
	if playback.AudioSource != nextURL || playback.TrackPositionSeconds != 0 {
		t.Fatalf("continuation lost beginning: %+v", playback)
	}
	if _, _, ok := state.BeginPlay(action, "slow"); ok {
		t.Fatal("late end event restarted the next track")
	}
	stale := map[string]any{"audioSource": testAudioURL, "previousAudioSource": testAudioURL}
	if _, _, ok := state.BeginPlay(stale, "slow"); ok {
		t.Fatal("stale end event skipped again")
	}
}
