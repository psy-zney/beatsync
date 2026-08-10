package room

import (
	"testing"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

func TestClientAvatarPersistsAcrossReconnectAndBroadcastList(t *testing.T) {
	t.Parallel()
	state := New("090624")
	_, _ = state.AddClient(model.Client{ClientID: "one", Username: "Alice", JoinedAt: 1})
	clients, err := state.UpdateAvatar("one", "🎧")
	if err != nil || len(clients) != 1 || clients[0].Avatar != "🎧" {
		t.Fatalf("avatar update failed: clients=%+v err=%v", clients, err)
	}
	state.RemoveClient("one")
	clients, _ = state.AddClient(model.Client{ClientID: "one", Username: "Alice 2", JoinedAt: 2})
	if len(clients) != 1 || clients[0].Avatar != "🎧" {
		t.Fatalf("avatar was not restored: %+v", clients)
	}
}

func TestPlaybackRequiresQueuedSource(t *testing.T) {
	t.Parallel()
	state := New("090624")
	action := map[string]any{"type": "PLAY", "audioSource": "missing", "trackTimeSeconds": 0.0}
	if _, ok := state.PlayImmediate(action); ok {
		t.Fatal("played a source that was not queued")
	}
	state.AddAudioSource(model.AudioSource{URL: "https://audio.test/a.mp3", Title: "A"})
	action["audioSource"] = "https://audio.test/a.mp3"
	if _, ok := state.PlayImmediate(action); !ok {
		t.Fatal("queued source was rejected")
	}
}

func TestPauseCancelsPendingPlayAndAlwaysBroadcasts(t *testing.T) {
	t.Parallel()
	state := New("090624")
	source := model.AudioSource{URL: "https://audio.test/a.mp3", Title: "A"}
	state.AddAudioSource(source)
	play := map[string]any{"type": "PLAY", "audioSource": source.URL, "trackTimeSeconds": 0.0}
	token, _, ok := state.BeginPlay(play, "initiator")
	if !ok {
		t.Fatal("failed to create pending play")
	}
	pause := map[string]any{"type": "PAUSE", "audioSource": "stale-client-source", "trackTimeSeconds": 12.0}
	if _, ok := state.Pause(pause); !ok {
		t.Fatal("pause of a stale client source was not broadcast")
	}
	if _, _, ok := state.ExecutePending(token); ok {
		t.Fatal("pending play survived pause")
	}
	_, playback, _, _, _, _, _ := state.State()
	if playback.Type != "paused" {
		t.Fatalf("playback type = %q", playback.Type)
	}
}

func TestReorderValidationStateIsCopyOnWrite(t *testing.T) {
	t.Parallel()
	state := New("090624")
	original := []model.AudioSource{{URL: "a"}, {URL: "b"}}
	state.SetAudioSources(original)
	original[0].URL = "mutated"
	sources, _, _, _, _, _, _ := state.State()
	if sources[0].URL != "a" {
		t.Fatal("room retained caller-owned slice")
	}
}

func TestPruneDisconnectedKeepsActiveClients(t *testing.T) {
	t.Parallel()
	state := New("090624")
	_, _ = state.AddClient(model.Client{ClientID: "active", Username: "A", JoinedAt: 1})
	_, _ = state.AddClient(model.Client{ClientID: "gone", Username: "B", JoinedAt: 1})
	state.RemoveClient("gone")
	if removed := state.PruneDisconnected(time.Now().Add(time.Minute)); removed != 1 {
		t.Fatalf("removed=%d", removed)
	}
	if _, ok := state.Client("active"); !ok {
		t.Fatal("active client was pruned")
	}
}
