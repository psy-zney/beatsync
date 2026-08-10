package spotify

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/config"
)

type Track struct {
	Title      string `json:"title"`
	Artist     string `json:"artist"`
	Album      string `json:"album,omitempty"`
	CoverURL   string `json:"coverUrl,omitempty"`
	DurationMS int64  `json:"durationMs,omitempty"`
}

type Result struct {
	Title    string  `json:"title"`
	Type     string  `json:"type"`
	CoverURL string  `json:"coverUrl,omitempty"`
	Tracks   []Track `json:"tracks"`
}

type Service struct {
	cfg         config.Config
	http        *http.Client
	mu          sync.Mutex
	token       string
	tokenExpiry time.Time
}

func New(cfg config.Config) *Service {
	return &Service{cfg: cfg, http: &http.Client{Timeout: cfg.HTTPTimeout}}
}

func Parse(raw string) (kind, id string, ok bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", "", false
	}
	host := strings.ToLower(u.Hostname())
	if host != "spotify.com" && !strings.HasSuffix(host, ".spotify.com") {
		return "", "", false
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	for index, part := range parts {
		if (part == "playlist" || part == "album" || part == "track") && index+1 < len(parts) && parts[index+1] != "" {
			return part, parts[index+1], true
		}
	}
	return "", "", false
}

func (s *Service) Resolve(ctx context.Context, raw string, maxTracks int) (Result, error) {
	kind, id, ok := Parse(raw)
	if !ok {
		return Result{}, errors.New("invalid Spotify URL")
	}
	if maxTracks < 1 {
		maxTracks = 1
	}
	if maxTracks > 500 {
		maxTracks = 500
	}
	if token := s.apiToken(ctx); token != "" {
		if result, err := s.official(ctx, token, kind, id, maxTracks); err == nil && len(result.Tracks) > 0 {
			return result, nil
		}
	}
	if result, err := s.embed(ctx, raw, kind, id, maxTracks); err == nil && len(result.Tracks) > 0 {
		return result, nil
	}
	return s.oembed(ctx, raw, kind)
}

func (s *Service) apiToken(ctx context.Context) string {
	if s.cfg.SpotifyClientID == "" || s.cfg.SpotifyClientSecret == "" {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.token != "" && time.Now().Before(s.tokenExpiry) {
		return s.token
	}
	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://accounts.spotify.com/api/token", strings.NewReader("grant_type=client_credentials"))
	request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(s.cfg.SpotifyClientID+":"+s.cfg.SpotifyClientSecret)))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := s.http.Do(request)
	if err != nil {
		return ""
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return ""
	}
	var data struct {
		Token   string `json:"access_token"`
		Expires int    `json:"expires_in"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 256<<10)).Decode(&data) != nil || data.Token == "" {
		return ""
	}
	s.token, s.tokenExpiry = data.Token, time.Now().Add(time.Duration(data.Expires)*time.Second-time.Minute)
	return s.token
}

type apiImage struct {
	URL string `json:"url"`
}
type apiArtist struct {
	Name string `json:"name"`
}
type apiTrack struct {
	Name    string      `json:"name"`
	Artists []apiArtist `json:"artists"`
	Album   *struct {
		Name   string     `json:"name"`
		Images []apiImage `json:"images"`
	} `json:"album"`
	Duration int64 `json:"duration_ms"`
}
type apiItem struct {
	Track *apiTrack `json:"track"`
	Item  *apiTrack `json:"item"`
}
type apiPage[T any] struct {
	Items []T    `json:"items"`
	Next  string `json:"next"`
}

func (s *Service) official(ctx context.Context, token, kind, id string, maxTracks int) (Result, error) {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.spotify.com/v1/"+kind+"s/"+url.PathEscape(id), nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := s.http.Do(request)
	if err != nil {
		return Result{}, err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return Result{}, fmt.Errorf("Spotify returned HTTP %d", response.StatusCode)
	}
	if kind == "track" {
		var track apiTrack
		if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&track); err != nil {
			return Result{}, err
		}
		mapped := mapTrack(track, "", "")
		return Result{Title: track.Name, Type: kind, CoverURL: mapped.CoverURL, Tracks: []Track{mapped}}, nil
	}
	if kind == "album" {
		var data struct {
			Name    string            `json:"name"`
			Images  []apiImage        `json:"images"`
			Artists []apiArtist       `json:"artists"`
			Tracks  apiPage[apiTrack] `json:"tracks"`
		}
		if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&data); err != nil {
			return Result{}, err
		}
		cover := firstImage(data.Images)
		artist := joinArtists(data.Artists)
		all, err := collectPages(s, ctx, token, data.Tracks, maxTracks)
		if err != nil {
			return Result{}, err
		}
		tracks := make([]Track, 0, len(all))
		for _, item := range all {
			tracks = append(tracks, mapTrack(item, data.Name, cover))
			if tracks[len(tracks)-1].Artist == "Unknown Artist" {
				tracks[len(tracks)-1].Artist = artist
			}
		}
		return Result{Title: data.Name, Type: kind, CoverURL: cover, Tracks: tracks}, nil
	}
	var data struct {
		Name   string            `json:"name"`
		Images []apiImage        `json:"images"`
		Items  *apiPage[apiItem] `json:"items"`
		Tracks *apiPage[apiItem] `json:"tracks"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&data); err != nil {
		return Result{}, err
	}
	page := data.Items
	if page == nil {
		page = data.Tracks
	}
	if page == nil {
		return Result{}, errors.New("Spotify omitted playlist items")
	}
	all, err := collectPages(s, ctx, token, *page, maxTracks)
	if err != nil {
		return Result{}, err
	}
	tracks := make([]Track, 0, len(all))
	for _, item := range all {
		track := item.Track
		if track == nil {
			track = item.Item
		}
		if track != nil {
			tracks = append(tracks, mapTrack(*track, "", ""))
		}
	}
	return Result{Title: data.Name, Type: kind, CoverURL: firstImage(data.Images), Tracks: tracks}, nil
}

func collectPages[T any](s *Service, ctx context.Context, token string, page apiPage[T], limit int) ([]T, error) {
	items := append([]T(nil), page.Items...)
	next := page.Next
	visited := make(map[string]bool)
	for next != "" && len(items) < limit {
		u, err := url.Parse(next)
		if err != nil || u.Scheme != "https" || u.Hostname() != "api.spotify.com" {
			return nil, errors.New("Spotify returned an untrusted pagination URL")
		}
		if visited[next] {
			return nil, errors.New("Spotify returned a repeated pagination URL")
		}
		visited[next] = true
		request, _ := http.NewRequestWithContext(ctx, http.MethodGet, next, nil)
		request.Header.Set("Authorization", "Bearer "+token)
		response, err := s.http.Do(request)
		if err != nil {
			return nil, err
		}
		var following apiPage[T]
		if response.StatusCode/100 != 2 {
			response.Body.Close()
			return nil, fmt.Errorf("Spotify pagination returned HTTP %d", response.StatusCode)
		}
		err = json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&following)
		response.Body.Close()
		if err != nil {
			return nil, err
		}
		items = append(items, following.Items...)
		next = following.Next
	}
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

var nextDataPattern = regexp.MustCompile(`(?s)<script[^>]+id=["']__NEXT_DATA__["'][^>]*>(.*?)</script>`)

func (s *Service) embed(ctx context.Context, _ string, kind, id string, maxTracks int) (Result, error) {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://open.spotify.com/embed/"+kind+"/"+url.PathEscape(id), nil)
	request.Header.Set("User-Agent", browserAgent)
	response, err := s.http.Do(request)
	if err != nil {
		return Result{}, err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return Result{}, fmt.Errorf("Spotify embed returned HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return Result{}, err
	}
	match := nextDataPattern.FindSubmatch(body)
	if len(match) < 2 {
		return Result{}, errors.New("Spotify embed data missing")
	}
	var root map[string]any
	if err := json.Unmarshal([]byte(html.UnescapeString(string(match[1]))), &root); err != nil {
		return Result{}, err
	}
	entity := digMap(root, "props", "pageProps", "state", "data", "entity")
	if entity == nil {
		return Result{}, errors.New("Spotify embed entity missing")
	}
	title := text(entity, "name", "title")
	if title == "" {
		title = "Spotify Import"
	}
	cover := imageFrom(entity)
	raw := collectEmbedTracks(entity, kind)
	if len(raw) > maxTracks {
		raw = raw[:maxTracks]
	}
	tracks := make([]Track, 0, len(raw))
	for _, value := range raw {
		if track, ok := embedTrack(value, cover); ok {
			tracks = append(tracks, track)
		}
	}
	return Result{Title: title, Type: kind, CoverURL: cover, Tracks: tracks}, nil
}

func (s *Service) oembed(ctx context.Context, raw, kind string) (Result, error) {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://open.spotify.com/oembed?url="+url.QueryEscape(raw), nil)
	response, err := s.http.Do(request)
	if err != nil {
		return Result{}, err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return Result{}, errors.New("could not resolve Spotify metadata")
	}
	var data struct {
		Title     string `json:"title"`
		Thumbnail string `json:"thumbnail_url"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&data) != nil {
		return Result{}, errors.New("invalid Spotify oEmbed response")
	}
	title, artist := data.Title, "Spotify"
	if before, after, found := strings.Cut(data.Title, " by "); found {
		title, artist = before, after
	}
	return Result{Title: data.Title, Type: kind, CoverURL: data.Thumbnail, Tracks: []Track{{Title: title, Artist: artist, CoverURL: data.Thumbnail}}}, nil
}

func mapTrack(value apiTrack, fallbackAlbum, fallbackCover string) Track {
	album, cover := fallbackAlbum, fallbackCover
	if value.Album != nil {
		if value.Album.Name != "" {
			album = value.Album.Name
		}
		if image := firstImage(value.Album.Images); image != "" {
			cover = image
		}
	}
	artist := joinArtists(value.Artists)
	if artist == "" {
		artist = "Unknown Artist"
	}
	return Track{Title: value.Name, Artist: artist, Album: album, CoverURL: cover, DurationMS: value.Duration}
}
func firstImage(images []apiImage) string {
	if len(images) > 0 {
		return images[0].URL
	}
	return ""
}
func joinArtists(artists []apiArtist) string {
	values := make([]string, 0, len(artists))
	for _, artist := range artists {
		if artist.Name != "" {
			values = append(values, artist.Name)
		}
	}
	return strings.Join(values, ", ")
}
func digMap(root map[string]any, keys ...string) map[string]any {
	current := root
	for _, key := range keys {
		next, ok := current[key].(map[string]any)
		if !ok {
			return nil
		}
		current = next
	}
	return current
}
func text(value map[string]any, keys ...string) string {
	for _, key := range keys {
		if result, ok := value[key].(string); ok && result != "" {
			return result
		}
	}
	return ""
}
func imageFrom(value map[string]any) string {
	if images, ok := value["images"].([]any); ok && len(images) > 0 {
		if image, ok := images[0].(map[string]any); ok {
			return text(image, "url")
		}
	}
	if art, ok := value["coverArt"].(map[string]any); ok {
		if sources, ok := art["sources"].([]any); ok && len(sources) > 0 {
			if image, ok := sources[0].(map[string]any); ok {
				return text(image, "url")
			}
		}
	}
	return ""
}
func collectEmbedTracks(entity map[string]any, kind string) []map[string]any {
	if kind == "track" {
		return []map[string]any{entity}
	}
	var result []map[string]any
	for _, key := range []string{"trackList", "items"} {
		if array, ok := entity[key].([]any); ok {
			result = append(result, mapSlice(array)...)
		}
	}
	if tracks, ok := entity["tracks"].(map[string]any); ok {
		if array, ok := tracks["items"].([]any); ok {
			result = append(result, mapSlice(array)...)
		}
	}
	collectNestedTracks(entity, &result)
	seen := make(map[string]bool)
	unique := result[:0]
	for _, track := range result {
		key := text(track, "uri", "id")
		if key == "" {
			key = text(track, "name", "title") + "|" + text(track, "subtitle")
		}
		if key == "|" || seen[key] {
			continue
		}
		seen[key] = true
		unique = append(unique, track)
	}
	return unique
}

func collectNestedTracks(value any, result *[]map[string]any) {
	switch current := value.(type) {
	case map[string]any:
		_, hasDurationMS := current["durationMs"]
		_, hasDuration := current["duration_ms"]
		if text(current, "name", "title") != "" && (hasDurationMS || hasDuration || text(current, "type") == "track") {
			*result = append(*result, current)
		}
		for _, child := range current {
			collectNestedTracks(child, result)
		}
	case []any:
		for _, child := range current {
			collectNestedTracks(child, result)
		}
	}
}
func mapSlice(values []any) []map[string]any {
	result := make([]map[string]any, 0, len(values))
	for _, value := range values {
		if item, ok := value.(map[string]any); ok {
			if nested, ok := item["track"].(map[string]any); ok {
				item = nested
			}
			if nested, ok := item["item"].(map[string]any); ok {
				item = nested
			}
			result = append(result, item)
		}
	}
	return result
}
func embedTrack(value map[string]any, cover string) (Track, bool) {
	title := text(value, "name", "title")
	if title == "" {
		return Track{}, false
	}
	artists := ""
	if list, ok := value["artists"].([]any); ok {
		names := make([]string, 0, len(list))
		for _, raw := range list {
			if name, ok := raw.(string); ok {
				names = append(names, name)
			} else if artist, ok := raw.(map[string]any); ok {
				names = append(names, text(artist, "name"))
			}
		}
		artists = strings.Join(names, ", ")
	}
	if artists == "" {
		artists = text(value, "subtitle")
	}
	if artists == "" {
		artists = "Unknown Artist"
	}
	duration := int64(0)
	for _, key := range []string{"durationMs", "duration_ms"} {
		if number, ok := value[key].(float64); ok {
			duration = int64(number)
			break
		}
	}
	if album, ok := value["album"].(map[string]any); ok {
		if image := imageFrom(album); image != "" {
			cover = image
		}
		return Track{Title: title, Artist: artists, Album: text(album, "name"), CoverURL: cover, DurationMS: duration}, true
	}
	return Track{Title: title, Artist: artists, CoverURL: cover, DurationMS: duration}, true
}

const browserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
