package youtube

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/config"
)

const (
	cacheTTL        = 10 * time.Minute
	refreshBuffer   = time.Minute
	maxCacheItems   = 128
	maxProcessBytes = 2 << 20
)

var videoIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

type Resolved struct {
	VideoID   string
	Title     string
	StreamURL string
}

type cachedStream struct {
	Resolved
	expires time.Time
}

type Service struct {
	cfg    config.Config
	http   *http.Client
	mu     sync.Mutex
	cache  map[string]cachedStream
	flight map[string]*flight
}

type flight struct {
	done   chan struct{}
	result Resolved
	err    error
}

func New(cfg config.Config) *Service {
	return &Service{
		cfg:    cfg,
		http:   &http.Client{Timeout: cfg.HTTPTimeout},
		cache:  make(map[string]cachedStream),
		flight: make(map[string]*flight),
	}
}

func ParseVideoID(input string) string {
	trimmed := strings.TrimSpace(input)
	if videoIDPattern.MatchString(trimmed) {
		return trimmed
	}
	if !strings.HasPrefix(trimmed, "http://") && !strings.HasPrefix(trimmed, "https://") {
		trimmed = "https://" + trimmed
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	var id string
	if host == "youtu.be" {
		id = strings.Split(strings.Trim(u.Path, "/"), "/")[0]
	} else if host == "youtube.com" || strings.HasSuffix(host, ".youtube.com") {
		id = u.Query().Get("v")
		if id == "" {
			parts := strings.Split(strings.Trim(u.Path, "/"), "/")
			if len(parts) >= 2 && (parts[0] == "shorts" || parts[0] == "embed" || parts[0] == "live" || parts[0] == "v") {
				id = parts[1]
			}
		}
	}
	if !videoIDPattern.MatchString(id) {
		return ""
	}
	return id
}

func ProxyURL(videoID string) string { return "/youtube/proxy?videoId=" + url.QueryEscape(videoID) }

func TrustedMediaURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "googlevideo.com" || strings.HasSuffix(host, ".googlevideo.com") || host == "youtube.com" || strings.HasSuffix(host, ".youtube.com") || host == "youtu.be"
}

func (s *Service) Invalidate(videoID string) { s.mu.Lock(); delete(s.cache, videoID); s.mu.Unlock() }

func (s *Service) Resolve(ctx context.Context, input string) (Resolved, error) {
	id := ParseVideoID(input)
	if id == "" {
		return Resolved{}, errors.New("invalid YouTube URL or video ID")
	}
	now := time.Now()
	s.mu.Lock()
	if cached, ok := s.cache[id]; ok && cached.expires.After(now) {
		s.mu.Unlock()
		return cached.Resolved, nil
	}
	if active := s.flight[id]; active != nil {
		s.mu.Unlock()
		select {
		case <-active.done:
			return active.result, active.err
		case <-ctx.Done():
			return Resolved{}, ctx.Err()
		}
	}
	active := &flight{done: make(chan struct{})}
	s.flight[id] = active
	s.mu.Unlock()

	result, err := s.extract(ctx, id)
	s.mu.Lock()
	active.result, active.err = result, err
	if err == nil {
		if len(s.cache) >= maxCacheItems {
			for key := range s.cache {
				delete(s.cache, key)
				break
			}
		}
		s.cache[id] = cachedStream{Resolved: result, expires: streamExpiry(result.StreamURL)}
	}
	delete(s.flight, id)
	close(active.done)
	s.mu.Unlock()
	return result, err
}

func (s *Service) Metadata(ctx context.Context, input string) (string, string, error) {
	id := ParseVideoID(input)
	if id == "" {
		return "", "", errors.New("invalid YouTube URL")
	}
	watch := "https://www.youtube.com/watch?v=" + id
	oembed := "https://www.youtube.com/oembed?format=json&url=" + url.QueryEscape(watch)
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, oembed, nil)
	request.Header.Set("User-Agent", browserAgent)
	if response, err := s.http.Do(request); err == nil {
		defer response.Body.Close()
		if response.StatusCode/100 == 2 {
			var data struct {
				Title string `json:"title"`
			}
			if json.NewDecoder(io.LimitReader(response.Body, 256<<10)).Decode(&data) == nil && strings.TrimSpace(data.Title) != "" {
				return strings.TrimSpace(data.Title), id, nil
			}
		}
	}
	resolved, err := s.Resolve(ctx, id)
	if err != nil {
		return "", id, err
	}
	return resolved.Title, id, nil
}

func (s *Service) Search(ctx context.Context, query string, offset int) (map[string]any, error) {
	query = strings.TrimSpace(query)
	if query == "" || offset < 0 || offset > 1000 {
		return nil, errors.New("invalid search parameters")
	}
	limit := 10
	want := offset + limit + 10
	if want > 50 {
		want = 50
	}
	target := fmt.Sprintf("ytsearch%d:%s", want, query)
	if id := ParseVideoID(query); id != "" {
		target = "https://www.youtube.com/watch?v=" + id
	}
	args := []string{"--dump-json", "--flat-playlist", "--no-warnings", "--no-cache-dir", "--skip-download", "--playlist-end", strconv.Itoa(want), target}
	output, err := s.run(ctx, s.cfg.YTDLPPath, args...)
	if err != nil {
		return nil, fmt.Errorf("YouTube search failed: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(output))
	items := make([]map[string]any, 0, limit)
	total := 0
	for {
		var item struct {
			ID         string  `json:"id"`
			Title      string  `json:"title"`
			Duration   float64 `json:"duration"`
			Channel    string  `json:"channel"`
			Uploader   string  `json:"uploader"`
			Thumbnail  string  `json:"thumbnail"`
			Thumbnails []struct {
				URL string `json:"url"`
			} `json:"thumbnails"`
		}
		if err := decoder.Decode(&item); err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return nil, err
		}
		if item.ID == "" || item.Duration <= 0 || item.Duration > 360 {
			continue
		}
		index := total
		total++
		if index < offset || len(items) >= limit {
			continue
		}
		performer := item.Channel
		if performer == "" {
			performer = item.Uploader
		}
		if performer == "" {
			performer = "YouTube User"
		}
		small, large := item.Thumbnail, item.Thumbnail
		if len(item.Thumbnails) > 0 {
			small = item.Thumbnails[0].URL
			large = item.Thumbnails[len(item.Thumbnails)-1].URL
		}
		items = append(items, map[string]any{
			"id": item.ID, "title": html.UnescapeString(item.Title), "duration": item.Duration,
			"parental_warning": false, "track_number": 1, "isrc": nil, "version": nil,
			"performer": map[string]any{"id": 0, "name": performer},
			"album": map[string]any{
				"id": "yt_album", "title": "YouTube", "duration": item.Duration,
				"parental_warning": false, "release_date_original": "Unknown",
				"image":   map[string]any{"small": small, "thumbnail": small, "large": large, "back": nil},
				"artists": []any{map[string]any{"id": 0, "name": performer, "roles": []string{"Main Artist"}}},
			},
		})
	}
	return map[string]any{"data": map[string]any{"tracks": map[string]any{"limit": limit, "offset": offset, "total": total, "items": items}}}, nil
}

func (s *Service) extract(ctx context.Context, id string) (Resolved, error) {
	watch := "https://www.youtube.com/watch?v=" + id
	if info, err := os.Stat(s.cfg.ExtractorPath); err == nil && !info.IsDir() {
		if output, runErr := s.run(ctx, s.cfg.ExtractorPath, watch); runErr == nil {
			var parsed struct {
				StreamURL string `json:"stream_url"`
				Title     string `json:"title"`
				Error     string `json:"error"`
			}
			if json.Unmarshal(output, &parsed) == nil && parsed.Error == "" && parsed.StreamURL != "" {
				if parsed.Title == "" {
					parsed.Title = "YouTube Audio"
				}
				return Resolved{VideoID: id, Title: parsed.Title, StreamURL: parsed.StreamURL}, nil
			}
		}
	}
	strategies := [][]string{
		{"--extractor-args", "youtube:player_client=ios,android,web"},
		{"--extractor-args", "youtube:player_client=android,web"},
		{"--extractor-args", "youtube:player_client=tv,web"},
		{},
	}
	var lastErr error
	for _, strategy := range strategies {
		args := []string{"--dump-single-json", "-f", "bestaudio/best", "--no-warnings", "--no-cache-dir", "--no-playlist"}
		if s.cfg.CookiesPath != "" {
			if _, err := os.Stat(s.cfg.CookiesPath); err == nil {
				args = append(args, "--cookies", s.cfg.CookiesPath)
			}
		}
		args = append(args, strategy...)
		args = append(args, watch)
		output, err := s.run(ctx, s.cfg.YTDLPPath, args...)
		if err != nil {
			lastErr = err
			continue
		}
		var parsed struct {
			URL   string `json:"url"`
			Title string `json:"title"`
		}
		if err := json.Unmarshal(output, &parsed); err != nil || parsed.URL == "" {
			lastErr = errors.New("yt-dlp returned no stream URL")
			continue
		}
		if parsed.Title == "" {
			parsed.Title = "YouTube Audio"
		}
		return Resolved{VideoID: id, Title: parsed.Title, StreamURL: parsed.URL}, nil
	}
	return Resolved{}, fmt.Errorf("failed to extract YouTube stream: %w", lastErr)
}

func (s *Service) run(parent context.Context, binary string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(parent, s.cfg.ExtractorTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, binary, args...)
	command.Env = append(os.Environ(), "YTDLP_PATH="+s.cfg.YTDLPPath, "YOUTUBE_COOKIES_PATH="+s.cfg.CookiesPath)
	var stdout, stderr cappedBuffer
	stdout.max, stderr.max = maxProcessBytes, 64<<10
	command.Stdout, command.Stderr = &stdout, &stderr
	err := command.Run()
	if ctx.Err() != nil {
		return nil, fmt.Errorf("extractor timed out: %w", ctx.Err())
	}
	if err != nil {
		return nil, fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
	}
	if stdout.overflow {
		return nil, errors.New("extractor output exceeded limit")
	}
	return stdout.Bytes(), nil
}

type cappedBuffer struct {
	bytes.Buffer
	max      int
	overflow bool
}

func (w *cappedBuffer) Write(p []byte) (int, error) {
	original := len(p)
	remaining := w.max - w.Len()
	if remaining <= 0 {
		w.overflow = true
		return original, nil
	}
	if len(p) > remaining {
		p = p[:remaining]
		w.overflow = true
	}
	_, _ = w.Buffer.Write(p)
	return original, nil
}

func streamExpiry(raw string) time.Time {
	if u, err := url.Parse(raw); err == nil {
		if value, err := strconv.ParseInt(u.Query().Get("expire"), 10, 64); err == nil && value > 0 {
			expires := time.Unix(value, 0).Add(-refreshBuffer)
			if expires.After(time.Now().Add(30 * time.Second)) {
				return expires
			}
		}
	}
	return time.Now().Add(cacheTTL)
}

const browserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
