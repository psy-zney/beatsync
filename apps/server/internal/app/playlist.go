package app

import (
	"context"
	"errors"
	"log"
	"os"
	"strings"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
	"github.com/psy-zney/beatsync/apps/server/internal/room"
	"github.com/psy-zney/beatsync/apps/server/internal/youtube"
)

const persistentRoomID = "090624"

func (a *App) loadPlaylist(parent context.Context, state *room.Room) {
	if state.ID != persistentRoomID || a.Store == nil {
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
		// Upgrade tracks to direct R2 links if already present in cache
		for i := range saved {
			if id := youtube.ParseVideoID(saved[i].URL); id != "" {
				if key := a.cachedYouTubeKey(parent, id); key != "" {
					saved[i].URL = a.Store.PublicURL(key)
				}
			}
		}
		state.SetAudioSources(saved)
		state.MarkPlaylistSaved()
		go a.triggerAutoLyrics(state.ID, state)

		// Sliding window preload: buffer the first 2 tracks for persistent room 090624
		preloadCount := min(2, len(saved))
		for i := 0; i < preloadCount; i++ {
			if id := youtube.ParseVideoID(saved[i].URL); id != "" {
				if a.cachedYouTubeKey(parent, id) == "" {
					a.queueStream(state.ID, state, id, saved[i].Title)
				}
			}
		}
	}
}

func (a *App) savePlaylist(parent context.Context, state *room.Room) error {
	if a.Config.Demo || state.ID != persistentRoomID {
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
		publicURL := a.Store.PublicURL(object.Key)
		if !used[publicURL] && !a.usedByOtherRoom(state.ID, publicURL) {
			if err := a.Store.Delete(ctx, object.Key); err != nil {
				return deleted, err
			}
			deleted++
		}
	}
	return deleted, nil
}

// wipeRoomR2Storage permanently purges all R2 storage objects for a room when it has been empty
// for > 5 minutes.
// NOTE: Room "090624" is the special persistent room and is strictly protected from being wiped.
func (a *App) wipeRoomR2Storage(parent context.Context, roomID string, state *room.Room) {
	if a.Store == nil || a.Config.Demo {
		return
	}
	// Persistent room 090624: strictly protected from storage wipe
	if roomID == persistentRoomID {
		log.Printf("[Special Room] %s is preserved; skipping R2 storage wipe", roomID)
		return
	}

	ctx, cancel := context.WithTimeout(parent, 45*time.Second)
	defer cancel()

	prefix := "room-" + roomID + "/"
	// 1. Delete all room-specific files on R2 (custom audio uploads, room playlist, etc.)
	objects, err := a.Store.List(ctx, prefix)
	if err == nil {
		deletedCount := 0
		for _, object := range objects {
			if delErr := a.Store.Delete(ctx, object.Key); delErr == nil {
				deletedCount++
			}
		}
		if deletedCount > 0 {
			log.Printf("wiped %d room object(s) under %s on R2", deletedCount, prefix)
		}
	}

	// 2. Clean up cached tracks (e.g. youtube-cache/) that are NOT used by any other active room
	if state != nil {
		sources, _, _, _, _, _, _ := state.State()
		deletedCache := 0
		for _, source := range sources {
			if !a.usedByOtherRoom(roomID, source.URL) {
				if key, ok := a.storageKey(source.URL); ok {
					// Safety guard: never delete anything belonging to special room 090624
					if strings.HasPrefix(key, "room-"+persistentRoomID+"/") {
						continue
					}
					if delErr := a.Store.Delete(ctx, key); delErr == nil {
						deletedCache++
					}
				}
			}
		}
		if deletedCache > 0 {
			log.Printf("purged %d unused cached audio object(s) on R2 for idle room=%s", deletedCache, roomID)
		}
	}
	log.Printf("R2 storage completely wiped for idle room=%s (empty > 5m)", roomID)
}
