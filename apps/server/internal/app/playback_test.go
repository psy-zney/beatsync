package app

import (
	"testing"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
	"github.com/psy-zney/beatsync/apps/server/internal/realtime"
	"github.com/psy-zney/beatsync/apps/server/internal/room"
)

// Exercise the real initial-state and message handlers without a network
// listener, so the load barrier can also be tested in the WebAssembly runtime.
func TestPlaybackHandlersRequireAllLoadAcknowledgements(t *testing.T) {
	application := &App{Hub: realtime.NewHub()}
	state := room.New("090624")
	source := model.AudioSource{URL: "https://audio.test/worker.mp3", Title: "Worker track"}
	state.AddAudioSource(source)
	first := realtime.NewClient(state.ID, "first", "First", false, nil)
	clients, _ := state.AddClient(model.Client{ClientID: first.ClientID})
	application.sendInitialState(first, state, clients)
	_, playback, _, _, _, _, _ := state.State()
	if playback.Type != "paused" {
		t.Fatal("initial autoplay started before loading")
	}
	if pending, ok := state.PendingSource(); !ok || pending.URL != source.URL {
		t.Fatal("initial autoplay did not request loading")
	}

	late := realtime.NewClient(state.ID, "late", "Late", false, nil)
	clients, _ = state.AddClient(model.Client{ClientID: late.ClientID})
	application.sendInitialState(late, state, clients)
	// Replace the initial autoplay with an explicit play/seek request.
	application.handleWSMessage(first, state, []byte(`{"type":"PLAY","audioSource":"https://audio.test/worker.mp3","trackTimeSeconds":8.25}`))
	loaded := []byte(`{"type":"AUDIO_SOURCE_LOADED","source":{"url":"https://audio.test/worker.mp3"}}`)
	application.handleWSMessage(late, state, loaded)
	_, playback, _, _, _, _, _ = state.State()
	if playback.Type != "paused" {
		t.Fatal("initiator was incorrectly assumed to have loaded")
	}
	application.handleWSMessage(first, state, loaded)
	_, playback, _, _, _, _, _ = state.State()
	if playback.Type != "playing" || playback.TrackPositionSeconds != 8.25 || playback.ServerTimeToExecute <= 0 {
		t.Fatalf("all clients loaded but playback was not scheduled correctly: %+v", playback)
	}

	state.AddAudioSource(model.AudioSource{URL: "https://audio.test/next.mp3", Title: "Next track"})
	continued := []byte(`{"type":"PLAY","audioSource":"https://audio.test/next.mp3","previousAudioSource":"https://audio.test/worker.mp3","trackTimeSeconds":0}`)
	application.handleWSMessage(first, state, continued)
	loadedNext := []byte(`{"type":"AUDIO_SOURCE_LOADED","source":{"url":"https://audio.test/next.mp3"}}`)
	application.handleWSMessage(first, state, loadedNext)
	application.handleWSMessage(late, state, continued)
	_, playback, _, _, _, _, _ = state.State()
	if playback.AudioSource != source.URL {
		t.Fatal("automatic continuation began before the late client loaded")
	}
	application.handleWSMessage(late, state, loadedNext)
	_, playback, _, _, _, _, _ = state.State()
	if playback.AudioSource != "https://audio.test/next.mp3" || playback.TrackPositionSeconds != 0 {
		t.Fatalf("duplicate continuation discarded readiness or skipped the beginning: %+v", playback)
	}
	application.handleWSMessage(late, state, continued)
	if _, pending := state.PendingSource(); pending {
		t.Fatal("late end event restarted loading after continuation already began")
	}
}
