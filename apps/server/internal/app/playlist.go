package app

import (
	"context"
	"errors"
	"os"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
	"github.com/psy-zney/beatsync/apps/server/internal/room"
)

func (a *App) loadPlaylist(parent context.Context, state *room.Room) {
	if a.Store == nil {
		return
	}
	sources, _, _, _, _, _, _ := state.State()
	if len(sources) > 0 || !state.MarkPlaylistLoaded() {
		return
	}
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	var saved []model.AudioSource
	err := a.Store.GetJSON(ctx, "room-"+state.ID+"/playlist.json", 4<<20, &saved)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) { /* local state remains authoritative */
		}
		return
	}
	if len(saved) > 0 {
		state.SetAudioSources(saved)
		state.MarkPlaylistSaved()
	}
}

func (a *App) savePlaylist(parent context.Context, state *room.Room) error {
	if a.Config.Demo {
		return nil
	}
	if a.Store == nil {
		return errors.New("object storage is not configured")
	}
	sources, _, _, _, _, _, _ := state.State()
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()
	if err := a.Store.PutJSON(ctx, "room-"+state.ID+"/playlist.json", sources); err != nil {
		return err
	}
	state.MarkPlaylistSaved()
	return nil
}

func (a *App) cleanupUnusedRoomFiles(parent context.Context, state *room.Room) (int, error) {
	if a.Store == nil {
		return 0, nil
	}
	prefix := "room-" + state.ID + "/"
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()
	objects, err := a.Store.List(ctx, prefix)
	if err != nil {
		return 0, err
	}
	sources, _, _, _, _, _, _ := state.State()
	used := make(map[string]bool, len(sources))
	for _, source := range sources {
		used[source.URL] = true
	}
	deleted := 0
	for _, object := range objects {
		if object.Key == prefix+"playlist.json" || object.Key == prefix {
			continue
		}
		if !used[a.Store.PublicURL(object.Key)] {
			if err := a.Store.Delete(ctx, object.Key); err != nil {
				return deleted, err
			}
			deleted++
		}
	}
	return deleted, nil
}
