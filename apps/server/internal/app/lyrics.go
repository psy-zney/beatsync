package app

import (
	"context"
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/hybrid"
	"github.com/psy-zney/beatsync/apps/server/internal/lyrics"
	"github.com/psy-zney/beatsync/apps/server/internal/model"
	"github.com/psy-zney/beatsync/apps/server/internal/room"
	"github.com/psy-zney/beatsync/apps/server/internal/youtube"
)

func extractVideoID(raw string) string {
	if id := youtube.CachedVideoID(raw); id != "" {
		return id
	}
	if parsed, err := url.Parse(raw); err == nil {
		if id := parsed.Query().Get("videoId"); id != "" && youtube.ParseVideoID(id) == id {
			return id
		}
	}
	return youtube.ParseVideoID(raw)
}

func (a *App) fetchYouTubeLyrics(ctx context.Context, id string) (model.YouTubeLyricsResult, error) {
	var result model.YouTubeLyricsResult
	if err := a.dispatchHybrid(ctx, hybrid.KindYouTubeLyrics, hybrid.YouTubeInput{Input: id}, &result); err == nil {
		return result, nil
	}
	return lyrics.FetchYouTube(ctx, a.Config.YTDLPPath, a.Config.CookiesPath, id)
}

func (a *App) startAutoLyrics() {
	a.lyricsContext, a.lyricsCancel = context.WithCancel(context.Background())
	count := max(1, min(a.Config.LyricsConcurrency, 4))
	a.lyricsWake = make(chan struct{}, count)
	for range count {
		a.lyricsWorkers.Add(1)
		go func() { defer a.lyricsWorkers.Done(); a.lyricsLoop() }()
	}
}

func (a *App) triggerAutoLyrics(_ string, _ *room.Room) {
	if a == nil || a.lyricsWake == nil {
		return
	}
	for range cap(a.lyricsWake) {
		select {
		case a.lyricsWake <- struct{}{}:
		default:
		}
	}
}

func (a *App) lyricsLoop() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		if a.lyricsContext.Err() != nil {
			return
		}
		state, source, token := a.nextLyricsJob()
		if state == nil {
			select {
			case <-a.lyricsContext.Done():
				return
			case <-a.lyricsWake:
			case <-ticker.C:
			}
			continue
		}
		a.fetchTrackLyrics(state, source, token)
	}
}

func (a *App) nextLyricsJob() (*room.Room, model.AudioSource, uint64) {
	rooms := a.Rooms.Rooms()
	// Across rooms, current songs outrank speculative preloading.
	for rank := 0; rank < 3; rank++ {
		for _, state := range rooms {
			candidates := state.LyricsCandidates()
			if rank >= len(candidates) {
				continue
			}
			source := candidates[rank]
			if updated, token, ok := state.BeginLyricsFetch(source.URL, time.Now()); ok {
				a.broadcastLyrics(state.ID, updated, source.URL)
				return state, source, token
			}
		}
	}
	return nil, model.AudioSource{}, 0
}

func (a *App) fetchTrackLyrics(state *room.Room, source model.AudioSource, token uint64) {
	// A provider/parser fault is contained to this job, and always leaves a
	// terminal retryable state instead of crashing or leaving fetching forever.
	defer func() {
		if recovered := recover(); recovered != nil {
			log.Printf("lyrics job failed: room=%s", state.ID)
			if updated, ok := state.FinishLyricsFetch(source.URL, token, nil, "error", time.Now()); ok {
				a.broadcastLyrics(state.ID, updated, source.URL)
			}
		}
	}()
	ctx, cancel := context.WithTimeout(a.lyricsContext, 55*time.Second)
	defer cancel()
	value, err := a.Lyrics.GetOrFetch(ctx, source.URL, extractVideoID(source.URL), source.Title, 0)
	status := "ready"
	if value == nil {
		status = "not_found"
	}
	if err != nil {
		status = "error"
		log.Printf("lyrics lookup retry scheduled: room=%s error=%s", state.ID, strings.Split(err.Error(), "\n")[0])
	}
	if current, ok := a.Rooms.Get(state.ID); !ok || current != state {
		return
	}
	if updated, ok := state.FinishLyricsFetch(source.URL, token, value, status, time.Now()); ok {
		a.broadcastLyrics(state.ID, updated, source.URL)
	}
}

func (a *App) broadcastLyrics(roomID string, sources []model.AudioSource, url string) {
	for _, source := range sources {
		if source.URL == url {
			a.Hub.Broadcast(roomID, roomEvent(map[string]any{"type": "TRACK_LYRICS_UPDATE", "audioSource": url, "lyrics": source.Lyrics, "lyricsState": source.LyricsState, "lyricsVersion": source.LyricsVersion}))
			return
		}
	}
}
