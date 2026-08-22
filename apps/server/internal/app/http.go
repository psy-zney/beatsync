package app

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/hybrid"
	"github.com/psy-zney/beatsync/apps/server/internal/model"
	"github.com/psy-zney/beatsync/apps/server/internal/spotify"
	"github.com/psy-zney/beatsync/apps/server/internal/youtube"
)

var (
	roomIDPattern   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	clientIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
)

func (a *App) Handler() http.Handler { return http.HandlerFunc(a.serveHTTP) }

func (a *App) serveHTTP(writer http.ResponseWriter, request *http.Request) {
	started := time.Now()
	a.setCORS(writer.Header())
	if request.Method == http.MethodOptions {
		writer.WriteHeader(http.StatusNoContent)
		return
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			log.Printf("panic serving %s: %v", request.URL.Path, recovered)
			jsonError(writer, "Internal server error", http.StatusInternalServerError)
		}
		log.Printf("%s %s %.1fms", request.Method, request.URL.Path, float64(time.Since(started).Microseconds())/1000)
	}()

	switch request.URL.Path {
	case "/":
		_, _ = io.WriteString(writer, "BeatSync Go backend")
	case "/ws":
		a.handleWebSocket(writer, request)
	case "/internal/worker":
		a.Hybrid.ServeHTTP(writer, request)
	case "/health":
		a.handleHealth(writer)
	case "/stats":
		a.handleStats(writer)
	case "/active-rooms":
		writeJSON(writer, http.StatusOK, a.Rooms.ActiveUsers())
	case "/discover":
		writeJSON(writer, http.StatusOK, a.Rooms.Discover())
	case "/default":
		a.handleDefault(writer, request)
	case "/voice/token":
		a.handleVoiceToken(writer, request)
	case "/spotify/resolve":
		a.handleSpotify(writer, request)
	case "/upload/get-presigned-url":
		a.handlePresign(writer, request)
	case "/upload/complete":
		a.handleUploadComplete(writer, request)
	case "/upload/youtube":
		a.handleYouTubeUpload(writer, request)
	case "/youtube/proxy":
		a.handleYouTubeProxy(writer, request)
	default:
		if a.Config.Demo && strings.HasPrefix(request.URL.Path, "/audio/") {
			a.handleDemoAudio(writer, request)
			return
		}
		jsonError(writer, "Not found", http.StatusNotFound)
	}
}

func (a *App) setCORS(header http.Header) {
	header.Set("Access-Control-Allow-Origin", "*")
	header.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	// Keep the two legacy development headers during the Bun-to-Go rollout so
	// an already-open client can still complete cross-origin POST preflights.
	header.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Range, ngrok-skip-browser-warning, bypass-tunnel-reminder")
	header.Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type, Accept-Ranges")
}

func (a *App) handleHealth(writer http.ResponseWriter) {
	memoryStatus := a.Memory.Status()
	status := "ok"
	if memoryStatus.Level != "normal" {
		status = "degraded"
	}
	queueStats := a.Queue.Stats()
	writeJSON(writer, http.StatusOK, map[string]any{"status": status, "uptimeMs": time.Since(a.startedAt).Milliseconds(), "startedAt": a.startedAt.UTC().Format(time.RFC3339), "rooms": a.Rooms.Count(), "memory": memoryStatus, "streamQueue": queueStats, "hybridWorker": a.Hybrid.Stats(queueStats.Pending)})
}

func (a *App) handleStats(writer http.ResponseWriter) {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	rooms := make([]map[string]any, 0, a.Rooms.Count())
	for _, room := range a.Rooms.Rooms() {
		clients := make([]map[string]any, 0)
		for _, client := range room.Clients() {
			clients = append(clients, map[string]any{"clientId": client.ClientID, "username": client.Username, "isCreator": client.IsCreator, "rtt": client.RTT, "location": client.Location})
		}
		roomStats := room.Stats()
		roomStats["clients"] = clients
		rooms = append(rooms, roomStats)
	}
	queueStats := a.Queue.Stats()
	writeJSON(writer, http.StatusOK, map[string]any{"memory": map[string]any{"process": map[string]any{"rss": formatBytes(a.Memory.Status().RSSBytes), "heapUsed": formatBytes(stats.HeapAlloc), "heapTotal": formatBytes(stats.HeapSys)}, "pressure": a.Memory.Status()}, "streamQueue": queueStats, "hybridWorker": a.Hybrid.Stats(queueStats.Pending), "status": map[string]any{"activeRooms": map[string]any{"total": len(rooms), "rooms": rooms}}})
}

func (a *App) handleDefault(writer http.ResponseWriter, _ *http.Request) {
	if a.Config.Demo || a.Store == nil {
		writeJSON(writer, http.StatusOK, []model.AudioSource{})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	objects, err := a.Store.List(ctx, "default/")
	if err != nil {
		jsonError(writer, "Failed to list default audio files", http.StatusInternalServerError)
		return
	}
	sources := make([]model.AudioSource, 0, len(objects))
	for _, object := range objects {
		if object.Key != "default/" {
			sources = append(sources, model.AudioSource{URL: a.Store.PublicURL(object.Key)})
		}
	}
	writeJSON(writer, http.StatusOK, sources)
}

func (a *App) handleVoiceToken(writer http.ResponseWriter, request *http.Request) {
	if !requireMethod(writer, request, http.MethodPost) {
		return
	}
	if a.Config.LiveKitURL == "" || a.Config.LiveKitAPIKey == "" || a.Config.LiveKitAPISecret == "" {
		jsonError(writer, "Voice chat is not configured", http.StatusServiceUnavailable)
		return
	}
	var payload struct {
		RoomID   string `json:"roomId"`
		ClientID string `json:"clientId"`
		Username string `json:"username"`
	}
	if decodeJSON(request, &payload) != nil || !regexp.MustCompile(`^\d{6}$`).MatchString(payload.RoomID) || !clientIDPattern.MatchString(payload.ClientID) || len(strings.TrimSpace(payload.Username)) < 1 || len([]rune(payload.Username)) > 32 {
		jsonError(writer, "Invalid voice token request", http.StatusBadRequest)
		return
	}
	now := time.Now().Unix()
	claims := map[string]any{"iss": a.Config.LiveKitAPIKey, "sub": payload.ClientID, "name": strings.TrimSpace(payload.Username), "nbf": now - 5, "exp": now + 900, "video": map[string]any{"roomJoin": true, "room": "beatsync-" + payload.RoomID, "canPublish": true, "canSubscribe": true}}
	token, err := jwtHS256(claims, a.Config.LiveKitAPISecret)
	if err != nil {
		jsonError(writer, "Failed to create voice token", http.StatusInternalServerError)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"serverUrl": a.Config.LiveKitURL, "participantToken": token})
}

func (a *App) handleSpotify(writer http.ResponseWriter, request *http.Request) {
	if !requireMethod(writer, request, http.MethodPost) {
		return
	}
	var payload struct {
		URL       string `json:"url"`
		MaxTracks int    `json:"maxTracks"`
	}
	if decodeJSON(request, &payload) != nil {
		jsonError(writer, "Invalid Spotify URL request payload", http.StatusBadRequest)
		return
	}
	if payload.MaxTracks == 0 {
		payload.MaxTracks = 500
	}
	ctx, cancel := context.WithTimeout(request.Context(), 45*time.Second)
	defer cancel()
	var result spotify.Result
	err := a.dispatchHybrid(ctx, hybrid.KindSpotifyResolve, hybrid.SpotifyResolveInput{URL: payload.URL, MaxTracks: payload.MaxTracks}, &result)
	if err != nil {
		result, err = a.Spotify.Resolve(ctx, payload.URL, payload.MaxTracks)
	}
	if err != nil {
		jsonError(writer, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (a *App) handlePresign(writer http.ResponseWriter, request *http.Request) {
	if !requireMethod(writer, request, http.MethodPost) {
		return
	}
	if a.Config.Demo {
		jsonError(writer, "Uploads disabled in demo mode", http.StatusForbidden)
		return
	}
	if a.Store == nil {
		jsonError(writer, "Object storage is not configured", http.StatusServiceUnavailable)
		return
	}
	var payload struct {
		RoomID      string `json:"roomId"`
		FileName    string `json:"fileName"`
		ContentType string `json:"contentType"`
	}
	if decodeJSON(request, &payload) != nil || !roomIDPattern.MatchString(payload.RoomID) || !validAudioType(payload.ContentType) {
		jsonError(writer, "Invalid request data", http.StatusBadRequest)
		return
	}
	if _, ok := a.Rooms.Get(payload.RoomID); !ok {
		jsonError(writer, "Room not found. Please join the room before uploading files.", http.StatusNotFound)
		return
	}
	fileName := uniqueFileName(payload.FileName)
	key := "room-" + payload.RoomID + "/" + fileName
	uploadURL, err := a.Store.PresignPut(key, payload.ContentType, 15*time.Minute)
	if err != nil {
		jsonError(writer, "Failed to generate upload URL", http.StatusInternalServerError)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"uploadUrl": uploadURL, "publicUrl": a.Store.PublicURL(key)})
}

func (a *App) handleUploadComplete(writer http.ResponseWriter, request *http.Request) {
	if !requireMethod(writer, request, http.MethodPost) {
		return
	}
	if a.Config.Demo {
		jsonError(writer, "Uploads disabled in demo mode", http.StatusForbidden)
		return
	}
	var payload struct {
		RoomID       string `json:"roomId"`
		OriginalName string `json:"originalName"`
		PublicURL    string `json:"publicUrl"`
	}
	if decodeJSON(request, &payload) != nil || payload.OriginalName == "" {
		jsonError(writer, "Invalid request data", http.StatusBadRequest)
		return
	}
	room, ok := a.Rooms.Get(payload.RoomID)
	if !ok {
		jsonError(writer, "Room not found. The room may have been closed during upload.", http.StatusNotFound)
		return
	}
	if a.Store == nil || !strings.HasPrefix(payload.PublicURL, strings.TrimRight(a.Config.S3PublicURL, "/")+"/room-"+payload.RoomID+"/") {
		jsonError(writer, "Invalid public URL", http.StatusBadRequest)
		return
	}
	sources := room.AddAudioSource(model.AudioSource{URL: payload.PublicURL, Title: payload.OriginalName})
	a.broadcastSources(payload.RoomID, sources)
	writeJSON(writer, http.StatusOK, map[string]any{"success": true})
}

func (a *App) handleYouTubeUpload(writer http.ResponseWriter, request *http.Request) {
	if !requireMethod(writer, request, http.MethodPost) {
		return
	}
	if a.Config.Demo {
		jsonError(writer, "Uploads disabled in demo mode", http.StatusForbidden)
		return
	}
	var payload struct {
		RoomID string `json:"roomId"`
		URL    string `json:"url"`
	}
	if decodeJSON(request, &payload) != nil {
		jsonError(writer, "Invalid request body format", http.StatusBadRequest)
		return
	}
	room, ok := a.Rooms.Get(payload.RoomID)
	if !ok {
		jsonError(writer, "Room not found", http.StatusNotFound)
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), a.Config.HTTPTimeout)
	defer cancel()
	title, videoID, err := a.youtubeMetadata(ctx, payload.URL)
	if err != nil {
		jsonError(writer, err.Error(), http.StatusInternalServerError)
		return
	}
	// Use the same durable cache pipeline as search results. Adding the proxy
	// URL directly made clients download from Googlevideo at throttled playback
	// speed; a 5 MiB track could therefore appear to need many minutes.
	a.queueStream(payload.RoomID, room, videoID, title)
	writeJSON(writer, http.StatusAccepted, map[string]any{"success": true, "title": title, "publicUrl": youtube.ProxyURL(videoID)})
}

func (a *App) handleYouTubeProxy(writer http.ResponseWriter, request *http.Request) {
	videoID, target := request.URL.Query().Get("videoId"), request.URL.Query().Get("url")
	if videoID != "" {
		resolved, err := a.YouTube.Resolve(request.Context(), videoID)
		if err != nil {
			jsonError(writer, err.Error(), http.StatusInternalServerError)
			return
		}
		target = resolved.StreamURL
	}
	if target == "" {
		jsonError(writer, "Missing 'videoId' or 'url' parameter", http.StatusBadRequest)
		return
	}
	if !youtube.TrustedMediaURL(target) {
		jsonError(writer, "Untrusted proxy target", http.StatusBadRequest)
		return
	}
	response, err := a.fetchYouTubeMedia(request.Context(), target, request.Header.Get("Range"))
	if err != nil {
		jsonError(writer, "Failed to proxy YouTube stream", http.StatusBadGateway)
		return
	}
	if videoID != "" && response.StatusCode == http.StatusForbidden {
		response.Body.Close()
		a.YouTube.Invalidate(videoID)
		resolved, resolveErr := a.YouTube.Resolve(request.Context(), videoID)
		if resolveErr != nil {
			jsonError(writer, resolveErr.Error(), http.StatusBadGateway)
			return
		}
		response, err = a.fetchYouTubeMedia(request.Context(), resolved.StreamURL, request.Header.Get("Range"))
		if err != nil {
			jsonError(writer, "Failed to proxy YouTube stream", http.StatusBadGateway)
			return
		}
	}
	defer response.Body.Close()
	for _, name := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Cache-Control"} {
		if value := response.Header.Get(name); value != "" {
			writer.Header().Set(name, value)
		}
	}
	writer.WriteHeader(response.StatusCode)
	_, _ = io.Copy(writer, response.Body)
}

func (a *App) fetchYouTubeMedia(ctx context.Context, target, byteRange string) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", browserAgent)
	request.Header.Set("Accept", "*/*")
	request.Header.Set("Origin", "https://www.youtube.com")
	request.Header.Set("Referer", "https://www.youtube.com/")
	if byteRange != "" {
		request.Header.Set("Range", byteRange)
	}
	return a.HTTP.Do(request)
}

func (a *App) handleDemoAudio(writer http.ResponseWriter, request *http.Request) {
	name, err := url.PathUnescape(strings.TrimPrefix(request.URL.Path, "/audio/"))
	if err != nil || name == "" || filepath.Base(name) != name {
		jsonError(writer, "File not found", http.StatusNotFound)
		return
	}
	filePath := filepath.Join(a.Config.DemoAudioDir, name)
	writer.Header().Set("Cache-Control", "public, max-age=3600, immutable")
	http.ServeFile(writer, request, filePath)
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
func jsonError(writer http.ResponseWriter, message string, status int) {
	writeJSON(writer, status, map[string]string{"error": message})
}
func requireMethod(writer http.ResponseWriter, request *http.Request, method string) bool {
	if request.Method != method {
		jsonError(writer, "Method not allowed", http.StatusMethodNotAllowed)
		return false
	}
	return true
}
func decodeJSON(request *http.Request, target any) error {
	defer request.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(request.Body, 1<<20))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}
func validAudioType(value string) bool {
	return strings.HasPrefix(value, "audio/") || value == "video/webm"
}
func uniqueFileName(original string) string {
	extension := strings.ToLower(filepath.Ext(filepath.Base(original)))
	if len(extension) > 10 {
		extension = ""
	}
	base := strings.TrimSuffix(filepath.Base(original), filepath.Ext(original))
	base = regexp.MustCompile(`[^A-Za-z0-9_-]+`).ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if base == "" {
		base = "audio"
	}
	if len(base) > 80 {
		base = base[:80]
	}
	random := make([]byte, 6)
	_, _ = rand.Read(random)
	return base + "-" + strconv.FormatInt(time.Now().UnixMilli(), 36) + "-" + hex.EncodeToString(random) + extension
}
func formatBytes(value uint64) string {
	units := []string{"B", "KB", "MB", "GB"}
	amount := float64(value)
	index := 0
	for amount >= 1024 && index < len(units)-1 {
		amount /= 1024
		index++
	}
	return fmt.Sprintf("%.2f %s", amount, units[index])
}
func jwtHS256(claims map[string]any, secret string) (string, error) {
	header, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	body, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(body)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(encoded))
	return encoded + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

const browserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
