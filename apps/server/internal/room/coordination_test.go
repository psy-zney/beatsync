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

	tests := []struct {
		client string
		source string
		ready  bool
	}{
		{client: "two", source: "wrong", ready: false},
		{client: "two", source: testAudioURL, ready: false},
		{client: "two", source: testAudioURL, ready: false}, // duplicate is harmless
		{client: "three", source: testAudioURL, ready: false},
		{client: "four", source: testAudioURL, ready: true},
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
