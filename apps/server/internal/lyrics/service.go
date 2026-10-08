package lyrics

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

const cacheVersion = model.LyricsResolverVersion
const MissingTTL = 15 * time.Minute
const maxCacheEntries = 512

type YouTubeFetcher func(context.Context, string) (model.YouTubeLyricsResult, error)
type cacheEntry struct {
	Lyrics  *model.TrackLyrics `json:"lyrics"`
	Expires time.Time          `json:"expires"`
	Version int                `json:"version"`
	Used    time.Time          `json:"-"`
	Query   string             `json:"-"`
}
type fetchCall struct {
	done   chan struct{}
	lyrics *model.TrackLyrics
	err    error
}
type Service struct {
	ytdlpPath     string
	cookiesPath   string
	lrclibBaseURL string
	httpClient    *http.Client
	mu            sync.Mutex
	cache         map[string]cacheEntry
	inflight      map[string]*fetchCall
	slots         chan struct{}
	directory     string
	youtubeFetch  YouTubeFetcher
}
type Option func(*Service)

func (s *Service) Stats() map[string]int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return map[string]int{"active": len(s.slots), "pending": max(0, len(s.inflight)-len(s.slots)), "capacity": cap(s.slots), "cached": len(s.cache)}
}

func WithCacheDirectory(path string) Option { return func(s *Service) { s.directory = path } }
func WithConcurrency(count int) Option {
	return func(s *Service) { s.slots = make(chan struct{}, max(1, min(count, 4))) }
}
func NewService(path, cookies string, options ...Option) *Service {
	service := &Service{ytdlpPath: path, cookiesPath: cookies, lrclibBaseURL: DefaultLRCLIBBase, httpClient: &http.Client{Timeout: 10 * time.Second}, cache: make(map[string]cacheEntry), inflight: make(map[string]*fetchCall), slots: make(chan struct{}, 1)}
	service.youtubeFetch = func(ctx context.Context, id string) (model.YouTubeLyricsResult, error) {
		return FetchYouTube(ctx, path, cookies, id)
	}
	for _, option := range options {
		option(service)
	}
	return service
}

// SetYouTubeFetcher is called during app initialization to prefer a hybrid
// worker. Provider work remains behind the same global concurrency limit.
func (s *Service) SetYouTubeFetcher(fetch YouTubeFetcher) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.youtubeFetch = fetch
}

func canonicalKey(key, id string) string {
	suffix := fmt.Sprintf(":original:v%d", cacheVersion)
	if id == "" {
		parsed, _ := url.Parse(key)
		if parsed != nil {
			id = parsed.Query().Get("videoId")
			if id == "" {
				pieces := strings.Split(parsed.Path, "/")
				if len(pieces) > 1 && pieces[len(pieces)-2] == "youtube-cache" {
					id = strings.TrimSuffix(pieces[len(pieces)-1], filepath.Ext(pieces[len(pieces)-1]))
				}
			}
		}
		if videoIDPattern.MatchString(key) {
			id = key
		}
	}
	if videoIDPattern.MatchString(id) {
		return "youtube:" + id + suffix
	}
	return "track:" + key + suffix
}

func (s *Service) GetOrFetch(ctx context.Context, key, id, title string, duration float64) (*model.TrackLyrics, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if key == "" {
		key = id
	}
	if key == "" {
		key = title
	}
	if key == "" {
		return nil, nil
	}
	key = canonicalKey(key, id)
	s.mu.Lock()
	if entry, ok := s.cache[key]; ok && time.Now().Before(entry.Expires) && (entry.Lyrics != nil || entry.Query == normalizeSearchString(title)) {
		entry.Used = time.Now()
		s.cache[key] = entry
		s.mu.Unlock()
		return model.CloneTrackLyrics(entry.Lyrics), nil
	}
	if call, ok := s.inflight[key]; ok {
		s.mu.Unlock()
		select {
		case <-call.done:
			return model.CloneTrackLyrics(call.lyrics), call.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	call := &fetchCall{done: make(chan struct{})}
	s.inflight[key] = call
	fetch := s.youtubeFetch
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.inflight, key); close(call.done); s.mu.Unlock() }()
	if value := s.loadDisk(key); value != nil {
		call.lyrics = value
		s.store(key, value, 30*24*time.Hour)
		return model.CloneTrackLyrics(value), nil
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-ctx.Done():
		call.err = ctx.Err()
		return nil, call.err
	}
	metadata := model.LyricsMetadata{Title: title, Duration: duration, Language: detectLanguage(title)}
	var youtubeError error
	if id != "" && fetch != nil {
		providerCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		result, err := fetch(providerCtx, id)
		cancel()
		youtubeError = err
		if ctx.Err() != nil {
			call.err = ctx.Err()
			return nil, call.err
		}
		if result.Metadata.Title != "" {
			metadata.Title = result.Metadata.Title
		}
		metadata.Track, metadata.Artist = result.Metadata.Track, result.Metadata.Artist
		if result.Metadata.Duration > 0 {
			metadata.Duration = result.Metadata.Duration
		}
		if result.Metadata.Language != "" {
			metadata.Language = result.Metadata.Language
		}
		if result.Lyrics != nil {
			if model.ValidTrackLyrics(result.Lyrics) && model.HasTrackLyrics(result.Lyrics) && languageMatches(lyricsText(result.Lyrics), metadata.Language) {
				call.lyrics = model.CloneTrackLyrics(result.Lyrics)
			} else {
				youtubeError = fmt.Errorf("YouTube returned invalid lyrics")
			}
		}
	}
	if call.lyrics == nil && metadata.Title != "" {
		providerCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		value, err := searchLRCLIB(providerCtx, s.httpClient, s.lrclibBaseURL, metadata)
		cancel()
		if err != nil {
			call.err = err
		} else {
			call.lyrics = value
		}
	}
	if ctx.Err() != nil {
		call.lyrics = nil
		call.err = ctx.Err()
		return nil, call.err
	}
	if call.lyrics != nil {
		call.lyrics.ResolverVersion = model.LyricsResolverVersion
		call.lyrics.Automatic = true
		call.err = nil
		s.store(key, call.lyrics, 30*24*time.Hour)
		s.saveDisk(key, call.lyrics)
		return model.CloneTrackLyrics(call.lyrics), nil
	}
	call.err = errors.Join(youtubeError, call.err)
	// Timeouts/cancellation/rate limiting must not poison the missing cache.
	if call.err == nil {
		s.store(key, nil, MissingTTL, title)
	}
	return nil, call.err
}

func lyricsText(value *model.TrackLyrics) string {
	var text strings.Builder
	text.WriteString(value.Plain)
	text.WriteString(value.Synced)
	for _, line := range value.Lines {
		text.WriteString(" " + line.Text)
	}
	return text.String()
}

func (s *Service) store(key string, value *model.TrackLyrics, ttl time.Duration, query ...string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.cache) >= maxCacheEntries {
		var oldest string
		var at time.Time
		for key, entry := range s.cache {
			if oldest == "" || entry.Used.Before(at) {
				oldest, at = key, entry.Used
			}
		}
		delete(s.cache, oldest)
	}
	s.cache[key] = cacheEntry{Lyrics: model.CloneTrackLyrics(value), Expires: time.Now().Add(ttl), Used: time.Now(), Version: cacheVersion}
	if len(query) > 0 {
		entry := s.cache[key]
		entry.Query = normalizeSearchString(query[0])
		s.cache[key] = entry
	}
}

// Used by tests/cache seeding; user edits stay in their room and are never
// published as global lyrics or timing offsets for another room.
func (s *Service) StoreManually(key string, value *model.TrackLyrics) {
	if key == "" || !model.ValidTrackLyrics(value) || !model.HasTrackLyrics(value) {
		return
	}
	s.store(canonicalKey(key, ""), value, 30*24*time.Hour)
}
func (s *Service) Invalidate(key, id string) {
	s.mu.Lock()
	delete(s.cache, canonicalKey(key, id))
	s.mu.Unlock()
	if s.directory != "" {
		_ = os.Remove(s.cachePath(canonicalKey(key, id)))
	}
}
func (s *Service) cachePath(key string) string {
	hash := sha256.Sum256([]byte(key))
	return filepath.Join(s.directory, hex.EncodeToString(hash[:])+".json")
}
func (s *Service) loadDisk(key string) *model.TrackLyrics {
	if s.directory == "" {
		return nil
	}
	data, err := readLimitedFile(s.cachePath(key), model.MaxLyricsBytes+1024)
	if err != nil {
		return nil
	}
	var entry cacheEntry
	if json.Unmarshal(data, &entry) != nil || entry.Version != cacheVersion || time.Now().After(entry.Expires) || !model.ValidTrackLyrics(entry.Lyrics) || !model.HasTrackLyrics(entry.Lyrics) {
		return nil
	}
	return entry.Lyrics
}
func (s *Service) saveDisk(key string, value *model.TrackLyrics) {
	if s.directory == "" || os.MkdirAll(s.directory, 0700) != nil {
		return
	}
	data, err := json.Marshal(cacheEntry{Lyrics: value, Expires: time.Now().Add(30 * 24 * time.Hour), Version: cacheVersion})
	if err != nil {
		return
	}
	temporary, err := os.CreateTemp(s.directory, "lyrics-*.tmp")
	if err != nil {
		return
	}
	defer os.Remove(temporary.Name())
	_, err = temporary.Write(data)
	closeErr := temporary.Close()
	if err == nil && closeErr == nil {
		_ = os.Rename(temporary.Name(), s.cachePath(key))
	}
	// Bound disk growth as well as memory. Expired/old cache files are disposable.
	entries, err := os.ReadDir(s.directory)
	if err != nil || len(entries) <= maxCacheEntries {
		return
	}
	type fileAge struct {
		name     string
		modified time.Time
	}
	var files []fileAge
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		info, err := entry.Info()
		if err == nil {
			files = append(files, fileAge{entry.Name(), info.ModTime()})
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].modified.Before(files[j].modified) })
	for i := 0; i < len(files)-maxCacheEntries; i++ {
		_ = os.Remove(filepath.Join(s.directory, files[i].name))
	}
}
