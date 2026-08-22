package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"

	"github.com/psy-zney/beatsync/apps/server/internal/hybrid"
	"github.com/psy-zney/beatsync/apps/server/internal/model"
	"github.com/psy-zney/beatsync/apps/server/internal/queue"
	"github.com/psy-zney/beatsync/apps/server/internal/room"
	"github.com/psy-zney/beatsync/apps/server/internal/youtube"
)

func (a *App) queueStream(roomID string, state *room.Room, trackID, trackName string) {
	trackID = strings.TrimSpace(trackID)
	if trackID == "" || !state.AddStreamJob(trackID) {
		return
	}
	a.Hub.Broadcast(roomID, map[string]any{"type": "STREAM_JOB_UPDATE", "activeJobCount": state.StreamJobCount()})
	var once sync.Once
	finish := func() {
		once.Do(func() {
			state.RemoveStreamJob(trackID)
			a.Hub.Broadcast(roomID, map[string]any{"type": "STREAM_JOB_UPDATE", "activeJobCount": state.StreamJobCount()})
		})
	}
	job := queue.Job{
		ID: roomID + ":" + trackID,
		Run: func(ctx context.Context) error {
			defer finish()
			err := a.streamTrack(ctx, roomID, state, trackID, trackName)
			if err != nil {
				log.Printf("stream job %s/%s failed: %v", roomID, trackID, err)
			}
			return err
		},
		Drop: func(err error) { log.Printf("stream job %s/%s dropped: %v", roomID, trackID, err); finish() },
	}
	if err := a.Queue.Submit(job); err != nil {
		finish()
		log.Printf("stream queue rejected %s/%s: %v", roomID, trackID, err)
	}
}

func (a *App) streamTrack(ctx context.Context, roomID string, state *room.Room, trackID, trackName string) error {
	if _, ok := a.Rooms.Get(roomID); !ok {
		return errors.New("room was released")
	}
	// A persisted R2 object is the durable YouTube cache. Check it before
	// resolving a fresh, short-lived Googlevideo URL; cache hits should not pay
	// the extractor's cold-start and network cost.
	if cachedVideoID := youtube.ParseVideoID(trackID); a.Store != nil && cachedVideoID != "" {
		if key := a.cachedYouTubeKey(ctx, cachedVideoID); key != "" {
			if trackName == "" {
				trackName = "YouTube Audio"
			}
			sources := state.AddAudioSource(model.AudioSource{URL: a.Store.PublicURL(key), Title: trackName})
			a.broadcastSources(roomID, sources)
			log.Printf("stream cache hit: room=%s video=%s", roomID, cachedVideoID)
			return nil
		}
	}
	streamURL, videoID, resolvedTitle, err := a.resolveProviderStream(ctx, trackID)
	if err != nil {
		return err
	}
	if trackName == "" {
		trackName = resolvedTitle
	}
	if trackName == "" {
		trackName = "track-" + trackID
	}
	if a.Store == nil {
		if videoID == "" {
			return errors.New("object storage is required for this provider")
		}
		sources := state.AddAudioSource(model.AudioSource{URL: youtube.ProxyURL(videoID), Title: trackName})
		a.broadcastSources(roomID, sources)
		return nil
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, streamURL, nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", browserAgent)
	if videoID != "" {
		request.Header.Set("Range", "bytes=0-")
	}
	response, err := a.HTTP.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return fmt.Errorf("audio download returned HTTP %d", response.StatusCode)
	}
	if response.ContentLength > a.Config.MaxAudioDownloadBytes {
		return fmt.Errorf("audio exceeds %d MiB limit", a.Config.MaxAudioDownloadBytes>>20)
	}
	contentType := response.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "audio/mpeg"
	}
	contentType = strings.Split(contentType, ";")[0]
	var key string
	if videoID != "" {
		key = "youtube-cache/" + videoID + extensionFor(contentType)
	} else {
		key = "room-" + roomID + "/" + uniqueFileName(trackName+extensionFor(contentType))
	}
	if err := a.Store.UploadStream(ctx, key, contentType, response.Body, a.Config.MaxAudioDownloadBytes); err != nil {
		return err
	}
	sources := state.AddAudioSource(model.AudioSource{URL: a.Store.PublicURL(key), Title: trackName})
	a.broadcastSources(roomID, sources)
	return nil
}

func (a *App) cachedYouTubeKey(ctx context.Context, videoID string) string {
	extensions := []string{"webm", "m4a", "mp3", "ogg"}
	exists := make([]bool, len(extensions))
	var wait sync.WaitGroup
	for index, extension := range extensions {
		wait.Add(1)
		go func() {
			defer wait.Done()
			key := "youtube-cache/" + videoID + "." + extension
			found, err := a.Store.Head(ctx, key)
			exists[index] = err == nil && found
		}()
	}
	wait.Wait()
	for index, found := range exists {
		if found {
			return "youtube-cache/" + videoID + "." + extensions[index]
		}
	}
	return ""
}

func (a *App) resolveProviderStream(ctx context.Context, trackID string) (streamURL, videoID, title string, err error) {
	if id := youtube.ParseVideoID(trackID); id != "" {
		var resolved youtube.Resolved
		resolveErr := a.dispatchHybrid(ctx, hybrid.KindYouTubeResolve, hybrid.YouTubeInput{Input: id}, &resolved)
		if resolveErr != nil {
			resolved, resolveErr = a.YouTube.Resolve(ctx, id)
		}
		if resolveErr != nil {
			return "", "", "", resolveErr
		}
		return resolved.StreamURL, id, resolved.Title, nil
	}
	if a.Config.ProviderURL == "" {
		return "", "", "", errors.New("PROVIDER_URL is not configured")
	}
	endpoint, parseErr := url.Parse(a.Config.ProviderURL)
	if parseErr != nil {
		return "", "", "", parseErr
	}
	endpoint.Path = path.Join(endpoint.Path, "api/track")
	query := endpoint.Query()
	query.Set("id", trackID)
	endpoint.RawQuery = query.Encode()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	response, requestErr := a.HTTP.Do(request)
	if requestErr != nil {
		return "", "", "", requestErr
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return "", "", "", fmt.Errorf("provider returned HTTP %d", response.StatusCode)
	}
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&payload) != nil || !payload.Success || payload.Data.URL == "" {
		return "", "", "", errors.New("provider returned an invalid stream response")
	}
	if parsed, parseErr := url.Parse(payload.Data.URL); parseErr != nil || !(parsed.Scheme == "http" || parsed.Scheme == "https") {
		return "", "", "", errors.New("provider returned an invalid stream URL")
	}
	return payload.Data.URL, "", "", nil
}

func extensionFor(contentType string) string {
	switch {
	case strings.Contains(contentType, "webm"):
		return ".webm"
	case strings.Contains(contentType, "mp4") || strings.Contains(contentType, "m4a"):
		return ".m4a"
	case strings.Contains(contentType, "ogg"):
		return ".ogg"
	default:
		return ".mp3"
	}
}
