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
	maxSearchItems  = 64
	searchCacheTTL  = 2 * time.Minute
	maxProcessBytes = 2 << 20
)

var videoIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
var cachedVideoIDPattern = regexp.MustCompile(`/youtube-cache/([A-Za-z0-9_-]{11})\.`)

type Resolved struct {
	VideoID   string
	Title     string
	StreamURL string
}

type cachedStream struct {
	Resolved
	expires time.Time
}

type searchItem struct {
	ID, Title, Performer, SmallThumbnail, LargeThumbnail string
	Duration                                             float64
}

type cachedSearch struct {
	items   []searchItem
	expires time.Time
}

type Service struct {
	cfg    config.Config
	http   *http.Client
	mu     sync.Mutex
	cache  map[string]cachedStream
	search map[string]cachedSearch
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
		search: make(map[string]cachedSearch),
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

func CachedVideoID(raw string) string {
	match := cachedVideoIDPattern.FindStringSubmatch(raw)
	if len(match) == 2 {
		return match[1]
	}
	return ""
}

func NeedsTitleHeal(rawURL, title string) bool {
	videoID := CachedVideoID(rawURL)
	if videoID == "" {
		return false
	}
	title = strings.TrimSpace(title)
	return title == "" || title == "YouTube" || title == "YouTube Audio" || title == videoID || strings.HasPrefix(title, "track-")
}

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

	// The TypeScript backend used a lightweight YouTube page request. Spawning
	// yt-dlp for every query adds noticeable process/network latency, especially
	// on a small VPS, so use the page data first and keep yt-dlp as the robust
	// fallback for layout changes, direct URLs, and deep pagination.
	if ParseVideoID(query) == "" {
		items, err := s.searchPage(ctx, query)
		if err == nil && offset < len(items) {
			return searchResponse(items, offset, 10), nil
		}
	}

	return s.searchWithYTDLP(ctx, query, offset)
}

func (s *Service) searchWithYTDLP(ctx context.Context, query string, offset int) (map[string]any, error) {
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
	items := make([]searchItem, 0, limit)
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
		items = append(items, searchItem{
			ID: item.ID, Title: html.UnescapeString(item.Title), Duration: item.Duration, Performer: performer,
			SmallThumbnail: small, LargeThumbnail: large,
		})
	}
	return searchResponseWithTotal(items, offset, limit, total), nil
}

func (s *Service) searchPage(ctx context.Context, query string) ([]searchItem, error) {
	cacheKey := strings.ToLower(strings.Join(strings.Fields(query), " "))
	now := time.Now()
	s.mu.Lock()
	if cached, ok := s.search[cacheKey]; ok && cached.expires.After(now) {
		items := append([]searchItem(nil), cached.items...)
		s.mu.Unlock()
		return items, nil
	}
	s.mu.Unlock()

	endpoint := "https://www.youtube.com/results?hl=en&search_query=" + url.QueryEscape(query)
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	request.Header.Set("User-Agent", browserAgent)
	request.Header.Set("Accept-Language", "en-US,en;q=0.9")
	request.Header.Set("Cookie", "CONSENT=YES+cb")
	response, err := s.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return nil, fmt.Errorf("YouTube search page returned HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	items, err := parseSearchPage(body)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	if len(s.search) >= maxSearchItems {
		for key := range s.search {
			delete(s.search, key)
			break
		}
	}
	s.search[cacheKey] = cachedSearch{items: append([]searchItem(nil), items...), expires: now.Add(searchCacheTTL)}
	s.mu.Unlock()
	return items, nil
}

func parseSearchPage(body []byte) ([]searchItem, error) {
	markers := [][]byte{[]byte("var ytInitialData ="), []byte("ytInitialData ="), []byte(`window["ytInitialData"] =`)}
	start := -1
	for _, marker := range markers {
		if index := bytes.Index(body, marker); index >= 0 {
			if objectStart := bytes.IndexByte(body[index+len(marker):], '{'); objectStart >= 0 {
				start = index + len(marker) + objectStart
				break
			}
		}
	}
	if start < 0 {
		return nil, errors.New("YouTube search data was not found")
	}

	var initial any
	if err := json.NewDecoder(bytes.NewReader(body[start:])).Decode(&initial); err != nil {
		return nil, fmt.Errorf("decode YouTube search data: %w", err)
	}
	items := make([]searchItem, 0, 20)
	seen := make(map[string]bool)
	var walk func(any)
	walk = func(value any) {
		switch node := value.(type) {
		case map[string]any:
			if raw, ok := node["videoRenderer"].(map[string]any); ok {
				if item, ok := searchItemFromRenderer(raw); ok && !seen[item.ID] {
					seen[item.ID] = true
					items = append(items, item)
				}
			}
			for _, child := range node {
				walk(child)
			}
		case []any:
			for _, child := range node {
				walk(child)
			}
		}
	}
	walk(initial)
	if len(items) == 0 {
		return nil, errors.New("YouTube search returned no playable videos")
	}
	return items, nil
}

func searchItemFromRenderer(renderer map[string]any) (searchItem, bool) {
	id, _ := renderer["videoId"].(string)
	duration := parseDurationText(textValue(renderer["lengthText"]))
	if !videoIDPattern.MatchString(id) || duration <= 0 || duration > 360 {
		return searchItem{}, false
	}
	title := html.UnescapeString(strings.TrimSpace(textValue(renderer["title"])))
	if title == "" {
		return searchItem{}, false
	}
	performer := strings.TrimSpace(textValue(renderer["ownerText"]))
	if performer == "" {
		performer = strings.TrimSpace(textValue(renderer["longBylineText"]))
	}
	if performer == "" {
		performer = "YouTube User"
	}
	thumbnails := thumbnailURLs(renderer["thumbnail"])
	small, large := "", ""
	if len(thumbnails) > 0 {
		small, large = thumbnails[0], thumbnails[len(thumbnails)-1]
	}
	return searchItem{ID: id, Title: title, Duration: duration, Performer: performer, SmallThumbnail: small, LargeThumbnail: large}, true
}

func textValue(value any) string {
	node, _ := value.(map[string]any)
	if text, _ := node["simpleText"].(string); text != "" {
		return text
	}
	runs, _ := node["runs"].([]any)
	var builder strings.Builder
	for _, raw := range runs {
		run, _ := raw.(map[string]any)
		text, _ := run["text"].(string)
		builder.WriteString(text)
	}
	return builder.String()
}

func thumbnailURLs(value any) []string {
	node, _ := value.(map[string]any)
	rawItems, _ := node["thumbnails"].([]any)
	items := make([]string, 0, len(rawItems))
	for _, raw := range rawItems {
		thumbnail, _ := raw.(map[string]any)
		if value, _ := thumbnail["url"].(string); value != "" {
			items = append(items, value)
		}
	}
	return items
}

func parseDurationText(value string) float64 {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) < 2 || len(parts) > 3 {
		return 0
	}
	total := 0
	for _, part := range parts {
		number, err := strconv.Atoi(part)
		if err != nil || number < 0 || number > 59 {
			return 0
		}
		total = total*60 + number
	}
	return float64(total)
}

func searchResponse(items []searchItem, offset, limit int) map[string]any {
	return searchResponseWithTotal(items[offset:min(offset+limit, len(items))], offset, limit, len(items))
}

func searchResponseWithTotal(items []searchItem, offset, limit, total int) map[string]any {
	serialized := make([]map[string]any, 0, len(items))
	for _, item := range items {
		serialized = append(serialized, map[string]any{
			"id": item.ID, "title": item.Title, "duration": item.Duration,
			"parental_warning": false, "track_number": 1, "isrc": nil, "version": nil,
			"performer": map[string]any{"id": 0, "name": item.Performer},
			"album": map[string]any{
				"id": "yt_album", "title": "YouTube", "duration": item.Duration,
				"parental_warning": false, "release_date_original": "Unknown",
				"image":   map[string]any{"small": item.SmallThumbnail, "thumbnail": item.SmallThumbnail, "large": item.LargeThumbnail, "back": nil},
				"artists": []any{map[string]any{"id": 0, "name": item.Performer, "roles": []string{"Main Artist"}}},
			},
		})
	}
	return map[string]any{"data": map[string]any{"tracks": map[string]any{"limit": limit, "offset": offset, "total": total, "items": serialized}}}
}

func (s *Service) extract(ctx context.Context, id string) (Resolved, error) {
	watch := "https://www.youtube.com/watch?v=" + id
	cookiesPath, cleanupCookies, err := s.snapshotCookies()
	if err != nil {
		return Resolved{}, fmt.Errorf("prepare YouTube cookies: %w", err)
	}
	defer cleanupCookies()
	if info, err := os.Stat(s.cfg.ExtractorPath); err == nil && !info.IsDir() {
		if output, runErr := s.runWithCookies(ctx, cookiesPath, s.cfg.ExtractorPath, watch); runErr == nil {
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
		if cookiesPath != "" {
			args = append(args, "--cookies", cookiesPath)
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
	return s.runWithCookies(parent, s.cfg.CookiesPath, binary, args...)
}

func (s *Service) runWithCookies(parent context.Context, cookiesPath, binary string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(parent, s.cfg.ExtractorTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, binary, args...)
	command.Env = append(os.Environ(), "YTDLP_PATH="+s.cfg.YTDLPPath, "YOUTUBE_COOKIES_PATH="+cookiesPath)
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

// yt-dlp updates a Netscape cookie jar when it exits. Production deliberately
// mounts the repository home read-only, so give each extraction a private,
// short-lived copy instead of letting yt-dlp mutate the canonical secret.
func (s *Service) snapshotCookies() (string, func(), error) {
	cleanup := func() {}
	if s.cfg.CookiesPath == "" {
		return "", cleanup, nil
	}
	source, err := os.Open(s.cfg.CookiesPath)
	if errors.Is(err, os.ErrNotExist) {
		return "", cleanup, nil
	}
	if err != nil {
		return "", cleanup, err
	}
	defer source.Close()
	info, err := source.Stat()
	if err != nil {
		return "", cleanup, err
	}
	if !info.Mode().IsRegular() || info.Size() > 4<<20 {
		return "", cleanup, errors.New("cookie file must be a regular file no larger than 4 MiB")
	}
	temporary, err := os.CreateTemp("", "beatsync-youtube-cookies-*.txt")
	if err != nil {
		return "", cleanup, err
	}
	name := temporary.Name()
	cleanup = func() { _ = os.Remove(name) }
	if err = temporary.Chmod(0o600); err == nil {
		_, err = io.Copy(temporary, source)
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		cleanup()
		return "", func() {}, err
	}
	return name, cleanup, nil
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
