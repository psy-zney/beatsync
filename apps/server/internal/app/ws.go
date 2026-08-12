package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
	"github.com/psy-zney/beatsync/apps/server/internal/realtime"
	"github.com/psy-zney/beatsync/apps/server/internal/room"
	"github.com/psy-zney/beatsync/apps/server/internal/youtube"
)

func (a *App) handleWebSocket(writer http.ResponseWriter, request *http.Request) {
	query := request.URL.Query()
	roomID, username, clientID := query.Get("roomId"), strings.TrimSpace(query.Get("username")), query.Get("clientId")
	if !roomIDPattern.MatchString(roomID) || username == "" || len([]rune(username)) > 32 || !clientIDPattern.MatchString(clientID) {
		jsonError(writer, "roomId, username and clientId are required", http.StatusBadRequest)
		return
	}
	if a.Config.Demo && roomID != a.Config.DemoRoomID {
		jsonError(writer, "Only room "+a.Config.DemoRoomID+" is available in demo mode", http.StatusBadRequest)
		return
	}
	if !a.Config.Demo && roomID != "090624" {
		jsonError(writer, "Only room 090624 is available", http.StatusBadRequest)
		return
	}
	if a.Hub.Count(roomID) >= a.Config.MaxConnectionsPerRoom {
		jsonError(writer, "Room is full", http.StatusServiceUnavailable)
		return
	}
	creator := !a.Config.Demo && a.Config.CreatorSecret != "" && query.Get("creator") == a.Config.CreatorSecret
	connection, err := a.upgrader.Upgrade(writer, request, nil)
	if err != nil {
		return
	}
	client := realtime.NewClient(roomID, clientID, username, creator, connection)
	a.Hub.Register(client)
	client.StartWriter()
	roomState := a.Rooms.GetOrCreate(roomID)
	if a.Config.Demo {
		a.prepareDemoRoom(roomState)
	} else {
		a.loadPlaylist(request.Context(), roomState)
	}
	clients, _ := roomState.AddClient(model.Client{Username: username, ClientID: clientID, IsCreator: creator, JoinedAt: nowMS()})
	a.sendInitialState(client, roomState, clients)
	log.Printf("WebSocket opened: room=%s client=%s user=%q", roomID, clientID, username)

	client.ReadPump(a.Config.MaxWebSocketMessageSize, func(payload []byte) { a.handleWSMessage(client, roomState, payload) })
	if a.Hub.Unregister(client) {
		clients = roomState.RemoveClient(clientID)
		if a.Config.Demo {
			a.Hub.Broadcast(roomID, map[string]any{"type": "DEMO_USER_COUNT", "count": roomState.ConnectionCount()})
			a.Hub.Broadcast(roomID, map[string]any{"type": "DEMO_AUDIO_READY_COUNT", "count": roomState.DemoReadyCount()})
		} else if roomState.ConnectionCount() > 0 {
			a.broadcastClients(roomID, clients)
		} else {
			roomState.StopSpatial()
		}
	}
	log.Printf("WebSocket closed: room=%s client=%s", roomID, clientID)
}

func (a *App) sendInitialState(client *realtime.Client, state *room.Room, clients []model.Client) {
	sources, playback, volume, lowPass, metronome, spatial, spatialStart := state.State()
	if len(sources) > 0 {
		event := map[string]any{"type": "SET_AUDIO_SOURCES", "sources": sources}
		if playback.AudioSource != "" {
			event["currentAudioSource"] = playback.AudioSource
		}
		client.Send(roomEvent(event))
		go a.healSourceTitles(client.RoomID, state, sources)
	}
	now := nowMS()
	client.Send(scheduled(now, map[string]any{"type": "GLOBAL_VOLUME_CONFIG", "volume": volume, "rampTime": 0.1}))
	client.Send(scheduled(now, map[string]any{"type": "METRONOME_CONFIG", "enabled": metronome}))
	client.Send(scheduled(now, map[string]any{"type": "LOW_PASS_CONFIG", "freq": lowPass, "rampTime": 0.05}))
	if spatial {
		client.Send(scheduled(now, spatialConfig(spatialStart)))
	}
	messages, newest := state.Chat()
	if len(messages) > 0 {
		client.Send(roomEvent(map[string]any{"type": "CHAT_UPDATE", "messages": messages, "isFullSync": true, "newestId": newest}))
	}
	if a.Config.Demo {
		if self, ok := state.Client(client.ClientID); ok {
			client.Send(roomEvent(map[string]any{"type": "CLIENT_CHANGE", "clients": []model.Client{self}}))
		}
		a.Hub.Broadcast(client.RoomID, map[string]any{"type": "DEMO_USER_COUNT", "count": state.ConnectionCount()})
		client.Send(map[string]any{"type": "DEMO_AUDIO_READY_COUNT", "count": state.DemoReadyCount()})
	} else {
		client.Send(roomEvent(map[string]any{"type": "CLIENT_CHANGE", "clients": clients}))
		a.broadcastClients(client.RoomID, clients)
	}
	if state.ConnectionCount() == 1 && len(sources) > 0 && playback.Type == "paused" {
		source := playback.AudioSource
		if source == "" {
			source = sources[0].URL
		}
		action := map[string]any{"type": "PLAY", "audioSource": source, "trackTimeSeconds": playback.TrackPositionSeconds}
		if executeAt, ok := state.PlayImmediate(action); ok {
			a.Hub.Broadcast(client.RoomID, scheduled(executeAt, action))
		}
	}
}

func (a *App) healSourceTitles(roomID string, state *room.Room, sources []model.AudioSource) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	changed := false
	for _, source := range sources {
		if ctx.Err() != nil {
			break
		}
		if !youtube.NeedsTitleHeal(source.URL, source.Title) {
			continue
		}
		title, _, err := a.YouTube.Metadata(ctx, youtube.CachedVideoID(source.URL))
		if err == nil && strings.TrimSpace(title) != "" {
			state.AddAudioSource(model.AudioSource{URL: source.URL, Title: title})
			changed = true
		}
	}
	if changed {
		current, _, _, _, _, _, _ := state.State()
		a.broadcastSources(roomID, current)
	}
}

func (a *App) handleWSMessage(client *realtime.Client, state *room.Room, payload []byte) {
	receivedAt := time.Now()
	t1 := float64(receivedAt.UnixNano()) / 1e6
	var message model.WSRequest
	if err := json.Unmarshal(payload, &message); err != nil || message.Type == "" {
		client.Send(map[string]any{"type": "ERROR", "message": "Invalid message format"})
		return
	}
	if message.Type == "NTP_REQUEST" {
		if !client.AllowNTP(receivedAt) {
			return
		}
		// Capture the send timestamp before touching shared room state. Only the
		// second packet updates client metrics, cutting room locks to one per pair.
		client.Send(map[string]any{"type": "NTP_RESPONSE", "t0": message.T0, "t1": t1, "t2": nowMS(), "probeGroupId": message.ProbeGroupID, "probeGroupIndex": message.ProbeGroupIndex})
		if message.ProbeGroupIndex == 1 {
			state.ProcessNTP(client.ClientID, message.ClientRTT, message.ClientCompensationMS, message.ClientNudgeMS)
		}
		return
	}
	state.Touch(client.ClientID)
	switch message.Type {
	case "UPDATE_PROFILE":
		clients, err := state.UpdateAvatar(client.ClientID, message.Avatar)
		if err == nil {
			a.broadcastClients(client.RoomID, clients)
		}
	case "PLAY":
		a.beginPlay(client, state, message)
	case "AUDIO_SOURCE_LOADED":
		if a.Config.Demo {
			count := state.MarkDemoReady(client.ClientID)
			a.Hub.Broadcast(client.RoomID, map[string]any{"type": "DEMO_AUDIO_READY_COUNT", "count": count})
			break
		}
		if token, ready := state.MarkAudioLoaded(client.ClientID, message.Source.URL); ready {
			a.executePlay(client.RoomID, state, token)
		}
	case "PAUSE":
		action := map[string]any{"type": "PAUSE", "audioSource": message.AudioSource, "trackTimeSeconds": message.TrackTimeSeconds}
		if executeAt, ok := state.Pause(action); ok {
			a.Hub.Broadcast(client.RoomID, scheduled(executeAt, action))
		}
	case "START_SPATIAL_AUDIO":
		start := state.StartSpatial()
		a.Hub.Broadcast(client.RoomID, scheduled(state.ScheduledTime(0), spatialConfig(start)))
	case "STOP_SPATIAL_AUDIO":
		state.StopSpatial()
		a.Hub.Broadcast(client.RoomID, scheduled(nowMS(), map[string]any{"type": "STOP_SPATIAL_AUDIO"}))
	case "REORDER_CLIENT":
		a.broadcastClients(client.RoomID, state.ReorderClient(message.ClientID))
	case "SET_LISTENING_SOURCE":
		state.SetListening(model.Position{X: message.X, Y: message.Y})
	case "MOVE_CLIENT":
		if state.MoveClient(message.ClientID, message.Position) {
			if moved, ok := state.Client(message.ClientID); ok {
				a.Hub.Broadcast(client.RoomID, roomEvent(map[string]any{"type": "CLIENT_MOVED", "clientId": message.ClientID, "position": moved.Position}))
			}
		}
	case "SYNC":
		if action, executeAt, ok := state.SyncAction(); ok {
			client.Send(scheduled(executeAt, action))
		}
	case "SEND_IP":
		a.broadcastClients(client.RoomID, state.UpdateLocation(client.ClientID, message.Location))
	case "LOAD_DEFAULT_TRACKS":
		go a.loadDefaults(client.RoomID, state)
	case "DELETE_AUDIO_SOURCES":
		go a.deleteSources(client.RoomID, state, message.URLs)
	case "SEARCH_MUSIC":
		go a.searchMusic(client, message.Query, message.Offset)
	case "STREAM_MUSIC":
		a.queueStream(client.RoomID, state, room.TrackIDString(message.TrackID), message.TrackName)
	case "SET_GLOBAL_VOLUME":
		at := state.SetGlobalVolume(message.Volume)
		a.Hub.Broadcast(client.RoomID, scheduled(at, map[string]any{"type": "GLOBAL_VOLUME_CONFIG", "volume": clamp(message.Volume, 0, 1), "rampTime": 0.1}))
	case "SEND_CHAT_MESSAGE":
		if chat, err := state.AddChat(client.ClientID, message.Text, message.ReplyToMessageID); err == nil {
			_, newest := state.Chat()
			a.Hub.Broadcast(client.RoomID, roomEvent(map[string]any{"type": "CHAT_UPDATE", "messages": []model.ChatMessage{chat}, "isFullSync": false, "newestId": newest}))
		}
	case "REORDER_AUDIO_SOURCES":
		if validReorder(state, message.ReorderedAudioSources) {
			a.broadcastSources(client.RoomID, state.SetAudioSources(message.ReorderedAudioSources))
		}
	case "SET_METRONOME":
		at := state.SetMetronome(message.Enabled)
		a.Hub.Broadcast(client.RoomID, scheduled(at, map[string]any{"type": "METRONOME_CONFIG", "enabled": message.Enabled}))
	case "SET_LOW_PASS_FREQ":
		at := state.SetLowPass(message.Freq)
		a.Hub.Broadcast(client.RoomID, scheduled(at, map[string]any{"type": "LOW_PASS_CONFIG", "freq": clamp(message.Freq, 20, 20_000), "rampTime": 0.05}))
	case "WEBRTC_SIGNAL":
		a.Hub.Send(client.RoomID, message.TargetClientID, map[string]any{"type": "WEBRTC_SIGNAL", "sourceClientId": client.ClientID, "signal": message.Signal})
	case "SAVE_PLAYLIST":
		go a.handleSavePlaylist(client, state)
	case "IMPORT_SPOTIFY_TRACKS":
		if len(message.Tracks) > 0 && len(message.Tracks) <= 500 {
			go a.importSpotify(client.RoomID, state, message.Tracks)
		}
	default:
		client.Send(map[string]any{"type": "ERROR", "message": "Invalid message format"})
	}
}

func (a *App) beginPlay(client *realtime.Client, state *room.Room, message model.WSRequest) {
	action := map[string]any{"type": "PLAY", "audioSource": message.AudioSource, "trackTimeSeconds": message.TrackTimeSeconds}
	if a.Config.Demo {
		if executeAt, ok := state.PlayImmediate(action); ok {
			a.Hub.Broadcast(client.RoomID, scheduled(executeAt, action))
		}
		return
	}
	token, source, ok := state.BeginPlay(action, client.ClientID)
	if !ok {
		return
	}
	a.Hub.Broadcast(client.RoomID, roomEvent(map[string]any{"type": "LOAD_AUDIO_SOURCE", "audioSourceToPlay": source}))
	time.AfterFunc(3*time.Second, func() { a.executePlay(client.RoomID, state, token) })
}
func (a *App) executePlay(roomID string, state *room.Room, token uint64) {
	action, executeAt, ok := state.ExecutePending(token)
	if ok {
		a.Hub.Broadcast(roomID, scheduled(executeAt, action))
	}
}

func (a *App) searchMusic(client *realtime.Client, query string, offset int) {
	ctx, cancel := context.WithTimeout(context.Background(), a.Config.ExtractorTimeout)
	defer cancel()
	data, err := a.YouTube.Search(ctx, query, offset)
	if err != nil {
		client.Send(map[string]any{"type": "SEARCH_RESPONSE", "response": map[string]any{"type": "error", "message": "An error occurred while searching"}})
		return
	}
	client.Send(map[string]any{"type": "SEARCH_RESPONSE", "response": map[string]any{"type": "success", "response": data}})
}

func (a *App) loadDefaults(roomID string, state *room.Room) {
	if a.Config.Demo || a.Store == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	objects, err := a.Store.List(ctx, "default/")
	if err != nil {
		return
	}
	sources, _, _, _, _, _, _ := state.State()
	seen := make(map[string]bool, len(sources))
	for _, source := range sources {
		seen[source.URL] = true
	}
	for _, object := range objects {
		u := a.Store.PublicURL(object.Key)
		if object.Key != "default/" && !seen[u] {
			sources = state.AddAudioSource(model.AudioSource{URL: u})
			seen[u] = true
		}
	}
	a.broadcastSources(roomID, sources)
}

func (a *App) prepareDemoRoom(state *room.Room) {
	entries, err := os.ReadDir(a.Config.DemoAudioDir)
	if err != nil {
		log.Printf("demo audio directory unavailable: %v", err)
		return
	}
	allowed := map[string]bool{".mp3": true, ".wav": true, ".flac": true, ".ogg": true, ".m4a": true, ".webm": true}
	sources := make([]model.AudioSource, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && allowed[strings.ToLower(filepath.Ext(entry.Name()))] {
			sources = append(sources, model.AudioSource{URL: "/audio/" + url.PathEscape(entry.Name()), Title: entry.Name()})
		}
	}
	state.PrepareDemo(sources)
}

func (a *App) deleteSources(roomID string, state *room.Room, urls []string) {
	if len(urls) == 0 {
		return
	}
	current, _, _, _, _, _, _ := state.State()
	allowed := make(map[string]bool)
	for _, source := range current {
		allowed[source.URL] = true
	}
	remove := make(map[string]bool)
	for _, raw := range urls {
		if !allowed[raw] {
			continue
		}
		key, ok := a.storageKey(raw)
		if !ok || a.Config.Demo {
			remove[raw] = true
			continue
		}
		if strings.Contains(key, "youtube-cache/") && a.usedByOtherRoom(roomID, raw) {
			remove[raw] = true
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		err := a.Store.Delete(ctx, key)
		cancel()
		if err == nil || errors.Is(err, os.ErrNotExist) {
			remove[raw] = true
		}
	}
	if len(remove) > 0 {
		a.broadcastSources(roomID, state.RemoveAudioSources(remove))
	}
}

func (a *App) handleSavePlaylist(client *realtime.Client, state *room.Room) {
	if a.Config.Demo {
		client.Send(map[string]any{"type": "SAVE_PLAYLIST_RESPONSE", "success": false, "message": "Saving playlists is disabled in demo mode.", "deletedCount": 0})
		return
	}
	err := a.savePlaylist(context.Background(), state)
	deleted := 0
	if err == nil {
		deleted, _ = a.cleanupUnusedRoomFiles(context.Background(), state)
		message := "Playlist saved successfully!"
		if deleted > 0 {
			message += " Cleaned up unused files from the bucket."
		}
		client.Send(map[string]any{"type": "SAVE_PLAYLIST_RESPONSE", "success": true, "message": message, "deletedCount": deleted})
		return
	}
	client.Send(map[string]any{"type": "SAVE_PLAYLIST_RESPONSE", "success": false, "message": "Failed to save playlist: " + err.Error(), "deletedCount": 0})
}

func (a *App) importSpotify(roomID string, state *room.Room, tracks []model.SpotifyTrack) {
	for _, track := range tracks {
		if _, ok := a.Rooms.Get(roomID); !ok {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), a.Config.ExtractorTimeout)
		result, err := a.YouTube.Search(ctx, track.Title+" "+track.Artist, 0)
		cancel()
		if err == nil {
			if id, title := firstSearchTrack(result); id != "" {
				if title == "" {
					title = track.Artist + " - " + track.Title
				}
				a.queueStream(roomID, state, id, title)
			}
		}
		time.Sleep(time.Second)
	}
}

func (a *App) broadcastClients(roomID string, clients []model.Client) {
	a.Hub.Broadcast(roomID, roomEvent(map[string]any{"type": "CLIENT_CHANGE", "clients": clients}))
}
func (a *App) broadcastSources(roomID string, sources []model.AudioSource) {
	a.Hub.Broadcast(roomID, roomEvent(map[string]any{"type": "SET_AUDIO_SOURCES", "sources": sources}))
}
func roomEvent(event map[string]any) map[string]any {
	return map[string]any{"type": "ROOM_EVENT", "event": event}
}
func scheduled(at float64, action map[string]any) map[string]any {
	return map[string]any{"type": "SCHEDULED_ACTION", "serverTimeToExecute": at, "scheduledAction": action}
}
func spatialConfig(start float64) map[string]any {
	return map[string]any{"type": "SPATIAL_CONFIG", "centerX": 50.0, "centerY": 50.0, "radius": 25.0, "speed": math.Pi / 3000, "startTime": start}
}
func validReorder(state *room.Room, sources []model.AudioSource) bool {
	if len(sources) == 0 {
		return false
	}
	current, _, _, _, _, _, _ := state.State()
	if len(current) != len(sources) {
		return false
	}
	counts := make(map[string]int)
	for _, source := range current {
		counts[source.URL]++
	}
	for _, source := range sources {
		counts[source.URL]--
	}
	for _, count := range counts {
		if count != 0 {
			return false
		}
	}
	return true
}
func firstSearchTrack(value map[string]any) (string, string) {
	data, _ := value["data"].(map[string]any)
	tracks, _ := data["tracks"].(map[string]any)
	items, _ := tracks["items"].([]map[string]any)
	if len(items) > 0 {
		return anyString(items[0]["id"]), anyString(items[0]["title"])
	}
	if generic, ok := tracks["items"].([]any); ok && len(generic) > 0 {
		if item, ok := generic[0].(map[string]any); ok {
			return anyString(item["id"]), anyString(item["title"])
		}
	}
	return "", ""
}
func anyString(value any) string {
	if item, ok := value.(string); ok {
		return item
	}
	return fmt.Sprint(value)
}
func nowMS() float64 { return float64(time.Now().UnixNano()) / 1e6 }
func clamp(value, minValue, maxValue float64) float64 {
	return math.Max(minValue, math.Min(maxValue, value))
}
func (a *App) usedByOtherRoom(roomID, raw string) bool {
	for _, candidate := range a.Rooms.Rooms() {
		if candidate.ID == roomID {
			continue
		}
		sources, _, _, _, _, _, _ := candidate.State()
		for _, source := range sources {
			if source.URL == raw {
				return true
			}
		}
	}
	return false
}
func (a *App) storageKey(raw string) (string, bool) {
	if a.Store == nil || a.Config.S3PublicURL == "" {
		return "", false
	}
	base, err1 := url.Parse(strings.TrimRight(a.Config.S3PublicURL, "/") + "/")
	target, err2 := url.Parse(raw)
	if err1 != nil || err2 != nil || base.Scheme != target.Scheme || base.Host != target.Host || !strings.HasPrefix(target.Path, base.Path) {
		return "", false
	}
	key := strings.TrimPrefix(target.Path, base.Path)
	key, err := url.PathUnescape(key)
	return key, err == nil && key != "" && !strings.Contains(key, "..")
}
