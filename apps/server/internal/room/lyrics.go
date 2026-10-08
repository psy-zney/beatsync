package room

import (
	"errors"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

const MaxLyricsBytes = model.MaxLyricsBytes

func ValidLyrics(lyrics *model.TrackLyrics) bool {
	return model.ValidTrackLyrics(lyrics)
}

func (r *Room) SetTrackLyrics(url string, lyrics *model.TrackLyrics, onlyIfEmpty bool) ([]model.AudioSource, error) {
	if !ValidLyrics(lyrics) {
		return nil, errors.New("Invalid lyrics: use at most 40 KB and a timing offset between -30 and 30 seconds")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for index, source := range r.audioSources {
		if source.URL != url {
			continue
		}
		if onlyIfEmpty && source.Lyrics != nil {
			return nil, nil
		}
		if lyrics != nil {
			lyrics = model.CloneTrackLyrics(lyrics)
			r.audioSources[index].LyricsState = "ready"
		} else {
			r.audioSources[index].LyricsState = ""
		}
		r.audioSources[index].Lyrics = lyrics
		r.lyricsToken++
		r.audioSources[index].LyricsVersion = r.lyricsToken
		delete(r.lyricsJobs, url)
		r.audioSources[index].LyricsRetryAt = time.Time{}
		r.audioSources[index].LyricsAttempts = 0
		r.playlistDirty = true
		return append([]model.AudioSource(nil), r.audioSources...), nil
	}
	return nil, errors.New("The track is no longer in the room queue")
}

// LyricsCandidates limits speculative work to the current/pending song and
// the next two. It stores track identities, never indexes across async work.
func (r *Room) LyricsCandidates() []model.AudioSource {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.audioSources) == 0 {
		return nil
	}
	current := r.playback.AudioSource
	if r.pending != nil {
		current, _ = r.pending.Action["audioSource"].(string)
	}
	index := 0
	for i, source := range r.audioSources {
		if source.URL == current {
			index = i
			break
		}
	}
	result := make([]model.AudioSource, 0, 3)
	for offset := 0; offset < min(3, len(r.audioSources)); offset++ {
		result = append(result, r.audioSources[(index+offset)%len(r.audioSources)])
	}
	return result
}

func (r *Room) BeginLyricsFetch(url string, now time.Time) ([]model.AudioSource, uint64, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, source := range r.audioSources {
		if source.URL != url {
			continue
		}
		if source.Lyrics != nil || source.LyricsState == "fetching" || source.LyricsRetryAt.After(now) {
			return nil, 0, false
		}
		if r.lyricsJobs == nil {
			r.lyricsJobs = make(map[string]uint64)
		}
		r.lyricsToken++
		r.lyricsJobs[url] = r.lyricsToken
		r.audioSources[i].LyricsState = "fetching"
		r.audioSources[i].LyricsVersion = r.lyricsToken
		return append([]model.AudioSource(nil), r.audioSources...), r.lyricsToken, true
	}
	return nil, 0, false
}

func (r *Room) FinishLyricsFetch(url string, token uint64, value *model.TrackLyrics, status string, now time.Time) ([]model.AudioSource, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.lyricsJobs[url] != token {
		return nil, false
	}
	delete(r.lyricsJobs, url)
	for i, source := range r.audioSources {
		if source.URL != url || source.Lyrics != nil {
			continue
		}
		if value != nil && (!ValidLyrics(value) || !model.HasTrackLyrics(value)) {
			value = nil
			status = "error"
		}
		if value != nil {
			r.audioSources[i].Lyrics = model.CloneTrackLyrics(value)
			status = "ready"
			r.audioSources[i].LyricsAttempts = 0
			r.audioSources[i].LyricsRetryAt = time.Time{}
			r.playlistDirty = true
		} else {
			if status == "not_found" {
				r.audioSources[i].LyricsRetryAt = now.Add(15 * time.Minute)
			} else {
				status = "error"
				r.audioSources[i].LyricsAttempts++
				delay := 10 * time.Second * time.Duration(1<<min(r.audioSources[i].LyricsAttempts-1, 5))
				r.audioSources[i].LyricsRetryAt = now.Add(min(delay, 5*time.Minute))
			}
		}
		r.audioSources[i].LyricsState = status
		r.lyricsToken++
		r.audioSources[i].LyricsVersion = r.lyricsToken
		return append([]model.AudioSource(nil), r.audioSources...), true
	}
	return nil, false
}

func (r *Room) RetryLyrics(url string) ([]model.AudioSource, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, source := range r.audioSources {
		if source.URL == url && source.Lyrics == nil && (source.LyricsState == "not_found" || source.LyricsState == "error") {
			// Cool down repeated user retries even when multiple clients click together.
			if r.lastLyricsRetry != nil && time.Since(r.lastLyricsRetry[url]) < 10*time.Second {
				return nil, false
			}
			if r.lastLyricsRetry == nil {
				r.lastLyricsRetry = make(map[string]time.Time)
			}
			r.lastLyricsRetry[url] = time.Now()
			r.audioSources[i].LyricsState = ""
			r.lyricsToken++
			r.audioSources[i].LyricsVersion = r.lyricsToken
			r.audioSources[i].LyricsRetryAt = time.Time{}
			return append([]model.AudioSource(nil), r.audioSources...), true
		}
	}
	return nil, false
}

func (r *Room) resetLyricsLocked() {
	r.lyricsJobs = make(map[string]uint64)
	for _, source := range r.audioSources {
		r.lyricsToken = max(r.lyricsToken, source.LyricsVersion)
	}
	for i := range r.audioSources {
		source := &r.audioSources[i]
		if !ValidLyrics(source.Lyrics) || !model.HasTrackLyrics(source.Lyrics) || model.LegacyAutomaticLyrics(source.Lyrics) {
			source.Lyrics = nil
		}
		source.LyricsRetryAt = time.Time{}
		source.LyricsAttempts = 0
		source.LyricsState = ""
		r.lyricsToken++
		source.LyricsVersion = r.lyricsToken
		if source.Lyrics != nil {
			source.LyricsState = "ready"
		}
	}
}

func (r *Room) SetTrackLyricsState(url string, lyricsState string) ([]model.AudioSource, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for index, source := range r.audioSources {
		if source.URL != url {
			continue
		}
		if source.Lyrics != nil {
			return nil, false
		}
		if source.LyricsState == lyricsState {
			return nil, false
		}
		r.audioSources[index].LyricsState = lyricsState
		return append([]model.AudioSource(nil), r.audioSources...), true
	}
	return nil, false
}

// Reordering accepts only URLs; preserve the current metadata under the same
// lock so a stale client cannot erase lyrics selected by another participant.
func (r *Room) ReorderAudioSources(sources []model.AudioSource) ([]model.AudioSource, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(sources) == 0 || len(sources) != len(r.audioSources) {
		return nil, false
	}
	current := make(map[string]model.AudioSource, len(r.audioSources))
	for _, source := range r.audioSources {
		current[source.URL] = source
	}
	ordered := make([]model.AudioSource, 0, len(sources))
	for _, source := range sources {
		existing, ok := current[source.URL]
		if !ok {
			return nil, false
		}
		ordered = append(ordered, existing)
		delete(current, source.URL)
	}
	r.audioSources = ordered
	r.playlistDirty = true
	return append([]model.AudioSource(nil), ordered...), true
}
