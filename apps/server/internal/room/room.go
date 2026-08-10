package room

import (
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

const (
	originX = 50.0
	originY = 50.0
	radius  = 25.0
	maxChat = 300
)

type PendingPlay struct {
	Token     uint64
	Action    map[string]any
	Loaded    map[string]bool
	Initiator string
}

type Room struct {
	mu sync.RWMutex
	ID string

	clients        map[string]*model.Client
	connected      map[string]bool
	audioSources   []model.AudioSource
	playback       model.PlaybackState
	globalVolume   float64
	lowPassFreq    float64
	metronome      bool
	spatial        bool
	spatialStart   float64
	listening      model.Position
	chat           []model.ChatMessage
	nextChatID     int64
	streamJobs     map[string]bool
	demoReady      map[string]bool
	pending        *PendingPlay
	pendingToken   uint64
	playlistDirty  bool
	playlistLoaded bool
	lastActivity   time.Time
}

func New(id string) *Room {
	return &Room{
		ID: id, clients: make(map[string]*model.Client), connected: make(map[string]bool),
		playback: model.PlaybackState{Type: "paused"}, globalVolume: 1, lowPassFreq: 20_000,
		listening: model.Position{X: originX, Y: originY}, nextChatID: 1,
		streamJobs: make(map[string]bool), demoReady: make(map[string]bool), lastActivity: time.Now(),
	}
}

func (r *Room) AddClient(client model.Client) ([]model.Client, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if cached := r.clients[client.ClientID]; cached != nil {
		client.Avatar, client.Location, client.JoinedAt, client.NudgeMS = cached.Avatar, cached.Location, cached.JoinedAt, cached.NudgeMS
	}
	copy := client
	r.clients[client.ClientID] = &copy
	r.connected[client.ClientID] = true
	r.lastActivity = time.Now()
	r.positionLocked()
	return r.clientsLocked(), nil
}

func (r *Room) RemoveClient(id string) []model.Client {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.connected, id)
	delete(r.demoReady, id)
	if client := r.clients[id]; client != nil {
		client.LastNTPResponse = nowMS()
	}
	if r.pending != nil {
		delete(r.pending.Loaded, id)
	}
	r.lastActivity = time.Now()
	r.positionLocked()
	r.trimClientCacheLocked(128)
	return r.clientsLocked()
}

func (r *Room) Touch(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if client := r.clients[id]; client != nil {
		client.LastNTPResponse = nowMS()
	}
	r.lastActivity = time.Now()
}

func (r *Room) ProcessNTP(id string, rtt, compensation, nudge *float64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	client := r.clients[id]
	if client == nil {
		return
	}
	client.LastNTPResponse = nowMS()
	if rtt != nil && *rtt > 0 {
		if client.RTT == 0 {
			client.RTT = *rtt
		} else {
			client.RTT = client.RTT*.8 + *rtt*.2
		}
	}
	if compensation != nil && *compensation >= 0 {
		client.CompensationMS = *compensation
	}
	if nudge != nil {
		client.NudgeMS = *nudge
	}
	r.lastActivity = time.Now()
}

func (r *Room) UpdateAvatar(id, avatar string) ([]model.Client, error) {
	if len(avatar) > 120_000 {
		return nil, errors.New("avatar too large")
	}
	if !strings.HasPrefix(avatar, "data:image/jpeg;base64,") && len([]rune(avatar)) > 8 {
		return nil, errors.New("invalid avatar")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	client := r.clients[id]
	if client == nil || !r.connected[id] {
		return nil, errors.New("client not connected")
	}
	client.Avatar = avatar
	return r.clientsLocked(), nil
}

func (r *Room) UpdateLocation(id string, location *model.Location) []model.Client {
	r.mu.Lock()
	defer r.mu.Unlock()
	if client := r.clients[id]; client != nil {
		client.Location = location
	}
	return r.clientsLocked()
}

func (r *Room) Clients() []model.Client { r.mu.RLock(); defer r.mu.RUnlock(); return r.clientsLocked() }
func (r *Room) Client(id string) (model.Client, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	c := r.clients[id]
	if c == nil {
		return model.Client{}, false
	}
	return *c, true
}
func (r *Room) ConnectionCount() int { r.mu.RLock(); defer r.mu.RUnlock(); return len(r.connected) }
func (r *Room) IsIdleBefore(cutoff time.Time) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.connected) == 0 && r.lastActivity.Before(cutoff)
}

func (r *Room) PruneDisconnected(cutoff time.Time) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	removed := 0
	for id, client := range r.clients {
		if r.connected[id] {
			continue
		}
		last := client.LastNTPResponse
		if last == 0 {
			last = client.JoinedAt
		}
		if last < float64(cutoff.UnixNano())/1e6 {
			delete(r.clients, id)
			removed++
		}
	}
	return removed
}

func (r *Room) State() ([]model.AudioSource, model.PlaybackState, float64, float64, bool, bool, float64) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return append([]model.AudioSource(nil), r.audioSources...), r.playback, r.globalVolume, r.lowPassFreq, r.metronome, r.spatial, r.spatialStart
}

func (r *Room) AddAudioSource(source model.AudioSource) []model.AudioSource {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, existing := range r.audioSources {
		if existing.URL == source.URL {
			return append([]model.AudioSource(nil), r.audioSources...)
		}
	}
	r.audioSources = append(r.audioSources, source)
	r.playlistDirty = true
	return append([]model.AudioSource(nil), r.audioSources...)
}

func (r *Room) SetAudioSources(sources []model.AudioSource) []model.AudioSource {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.audioSources = append([]model.AudioSource(nil), sources...)
	r.playlistDirty = true
	return append([]model.AudioSource(nil), r.audioSources...)
}

func (r *Room) RemoveAudioSources(urls map[string]bool) []model.AudioSource {
	r.mu.Lock()
	defer r.mu.Unlock()
	filtered := r.audioSources[:0]
	for _, source := range r.audioSources {
		if !urls[source.URL] {
			filtered = append(filtered, source)
		}
	}
	r.audioSources = filtered
	r.playlistDirty = true
	if urls[r.playback.AudioSource] {
		r.playback = model.PlaybackState{Type: "paused"}
	}
	return append([]model.AudioSource(nil), r.audioSources...)
}

func (r *Room) HasSource(url string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.hasSourceLocked(url)
}

func (r *Room) BeginPlay(action map[string]any, initiator string) (uint64, model.AudioSource, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	url, _ := action["audioSource"].(string)
	for _, source := range r.audioSources {
		if source.URL == url {
			r.pendingToken++
			r.pending = &PendingPlay{Token: r.pendingToken, Action: action, Loaded: map[string]bool{initiator: true}, Initiator: initiator}
			return r.pendingToken, source, true
		}
	}
	return 0, model.AudioSource{}, false
}

func (r *Room) MarkAudioLoaded(id, sourceURL string) (uint64, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.pending == nil || r.pending.Action["audioSource"] != sourceURL {
		return 0, false
	}
	r.pending.Loaded[id] = true
	for clientID := range r.connected {
		if !r.pending.Loaded[clientID] {
			return r.pending.Token, false
		}
	}
	return r.pending.Token, true
}

func (r *Room) ExecutePending(token uint64) (map[string]any, float64, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.pending == nil || r.pending.Token != token {
		return nil, 0, false
	}
	action := r.pending.Action
	r.pending = nil
	url, _ := action["audioSource"].(string)
	position, _ := action["trackTimeSeconds"].(float64)
	if !r.hasSourceLocked(url) {
		return nil, 0, false
	}
	executeAt := r.scheduledTimeLocked(0)
	r.playback = model.PlaybackState{Type: "playing", AudioSource: url, TrackPositionSeconds: position, ServerTimeToExecute: executeAt}
	return action, executeAt, true
}

func (r *Room) PlayImmediate(action map[string]any) (float64, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	url, _ := action["audioSource"].(string)
	position, _ := action["trackTimeSeconds"].(float64)
	if !r.hasSourceLocked(url) {
		return 0, false
	}
	executeAt := r.scheduledTimeLocked(0)
	r.playback = model.PlaybackState{Type: "playing", AudioSource: url, TrackPositionSeconds: position, ServerTimeToExecute: executeAt}
	return executeAt, true
}

func (r *Room) Pause(action map[string]any) (float64, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	url, _ := action["audioSource"].(string)
	position, _ := action["trackTimeSeconds"].(float64)
	if !r.hasSourceLocked(url) {
		r.playback = model.PlaybackState{Type: "paused"}
		return 0, false
	}
	executeAt := r.scheduledTimeLocked(0)
	r.playback = model.PlaybackState{Type: "paused", AudioSource: url, TrackPositionSeconds: position, ServerTimeToExecute: executeAt}
	return executeAt, true
}

func (r *Room) SyncAction() (map[string]any, float64, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.playback.Type != "playing" {
		return nil, 0, false
	}
	executeAt := r.scheduledTimeLocked(1500)
	position := r.playback.TrackPositionSeconds + (executeAt-r.playback.ServerTimeToExecute)/1000
	return map[string]any{"type": "PLAY", "audioSource": r.playback.AudioSource, "trackTimeSeconds": position}, executeAt, true
}

func (r *Room) ScheduledTime(extraMS float64) float64 {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.scheduledTimeLocked(extraMS)
}

func (r *Room) SetGlobalVolume(value float64) float64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.globalVolume = clamp(value, 0, 1)
	return nowMS()
}
func (r *Room) SetLowPass(value float64) float64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lowPassFreq = clamp(value, 20, 20_000)
	return nowMS()
}
func (r *Room) SetMetronome(value bool) float64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.metronome = value
	return nowMS()
}
func (r *Room) StartSpatial() float64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.spatial = true
	r.spatialStart = nowMS()
	return r.spatialStart
}
func (r *Room) StopSpatial() { r.mu.Lock(); r.spatial = false; r.mu.Unlock() }

func (r *Room) MoveClient(id string, p model.Position) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	c := r.clients[id]
	if c == nil {
		return false
	}
	c.Position = model.Position{X: clamp(p.X, 0, 100), Y: clamp(p.Y, 0, 100)}
	return true
}
func (r *Room) SetListening(p model.Position) {
	r.mu.Lock()
	r.listening = model.Position{X: clamp(p.X, 0, 100), Y: clamp(p.Y, 0, 100)}
	r.mu.Unlock()
}
func (r *Room) ReorderClient(id string) []model.Client {
	r.mu.Lock()
	defer r.mu.Unlock()
	ids := r.connectedIDsLocked()
	idx := sort.SearchStrings(ids, id)
	if idx < len(ids) && ids[idx] == id {
		ids = append(ids[:idx], ids[idx+1:]...)
		ids = append(ids, id)
	}
	r.positionByIDsLocked(ids)
	return r.clientsLocked()
}

func (r *Room) AddChat(clientID, text string, replyID *int64) (model.ChatMessage, error) {
	text = strings.TrimSpace(text)
	if text == "" || len([]rune(text)) > 1000 {
		return model.ChatMessage{}, errors.New("invalid chat message")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	client := r.clients[clientID]
	if client == nil {
		return model.ChatMessage{}, errors.New("client not found")
	}
	message := model.ChatMessage{ID: r.nextChatID, ClientID: clientID, Username: client.Username, Text: text, Timestamp: nowMS(), IsCreator: client.IsCreator}
	if client.Location != nil {
		message.CountryCode = client.Location.CountryCode
	}
	if replyID != nil {
		for _, old := range r.chat {
			if old.ID == *replyID {
				message.ReplyTo = &model.ChatReply{ID: old.ID, Username: old.Username, Text: old.Text}
				break
			}
		}
	}
	r.nextChatID++
	r.chat = append(r.chat, message)
	if len(r.chat) > maxChat {
		r.chat = append([]model.ChatMessage(nil), r.chat[len(r.chat)-maxChat:]...)
	}
	return message, nil
}
func (r *Room) Chat() ([]model.ChatMessage, int64) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return append([]model.ChatMessage(nil), r.chat...), r.nextChatID - 1
}

func (r *Room) AddStreamJob(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.streamJobs[id] {
		return false
	}
	r.streamJobs[id] = true
	return true
}
func (r *Room) RemoveStreamJob(id string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.streamJobs, id)
	return len(r.streamJobs)
}
func (r *Room) StreamJobCount() int { r.mu.RLock(); defer r.mu.RUnlock(); return len(r.streamJobs) }

func (r *Room) MarkDemoReady(id string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.connected[id] {
		r.demoReady[id] = true
	}
	return len(r.demoReady)
}
func (r *Room) DemoReadyCount() int { r.mu.RLock(); defer r.mu.RUnlock(); return len(r.demoReady) }
func (r *Room) PrepareDemo(sources []model.AudioSource) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.audioSources) == 0 {
		r.audioSources = append([]model.AudioSource(nil), sources...)
	}
	r.globalVolume = 0.8
}

func (r *Room) Snapshot() model.RoomBackup {
	r.mu.RLock()
	defer r.mu.RUnlock()
	clients := make([]model.Client, 0, len(r.clients))
	for _, c := range r.clients {
		clients = append(clients, *c)
	}
	return model.RoomBackup{ClientDatas: clients, AudioSources: append([]model.AudioSource(nil), r.audioSources...), GlobalVolume: r.globalVolume, LowPassFreq: r.lowPassFreq, PlaybackState: r.playback}
}
func (r *Room) Restore(backup model.RoomBackup) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.audioSources = append([]model.AudioSource(nil), backup.AudioSources...)
	r.globalVolume = backup.GlobalVolume
	r.lowPassFreq = backup.LowPassFreq
	r.playback = model.PlaybackState{Type: "paused"}
	for _, source := range r.audioSources {
		if source.URL == backup.PlaybackState.AudioSource {
			r.playback = backup.PlaybackState
			break
		}
	}
	for i := range backup.ClientDatas {
		c := backup.ClientDatas[i]
		r.clients[c.ClientID] = &c
	}
	r.lastActivity = time.Now()
}
func (r *Room) MarkPlaylistSaved() {
	r.mu.Lock()
	r.playlistDirty = false
	r.playlistLoaded = true
	r.mu.Unlock()
}
func (r *Room) MarkPlaylistLoaded() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.playlistLoaded {
		return false
	}
	r.playlistLoaded = true
	return true
}
func (r *Room) PlaylistDirty() bool { r.mu.RLock(); defer r.mu.RUnlock(); return r.playlistDirty }

func (r *Room) Discovery() map[string]any {
	sources, state, _, _, _, _, _ := r.State()
	return map[string]any{"roomId": r.ID, "clients": r.Clients(), "audioSources": sources, "playbackState": state}
}
func (r *Room) Stats() map[string]any {
	sources, _, _, _, _, spatial, _ := r.State()
	return map[string]any{"roomId": r.ID, "clientCount": r.ConnectionCount(), "audioSourceCount": len(sources), "hasSpatialAudio": spatial}
}

func (r *Room) clientsLocked() []model.Client {
	ids := r.connectedIDsLocked()
	result := make([]model.Client, 0, len(ids))
	for _, id := range ids {
		result = append(result, *r.clients[id])
	}
	return result
}
func (r *Room) connectedIDsLocked() []string {
	ids := make([]string, 0, len(r.connected))
	for id := range r.connected {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
func (r *Room) trimClientCacheLocked(limit int) {
	if len(r.clients) <= limit {
		return
	}
	type cached struct {
		id   string
		last float64
	}
	stale := make([]cached, 0, len(r.clients)-len(r.connected))
	for id, client := range r.clients {
		if !r.connected[id] {
			last := client.LastNTPResponse
			if last == 0 {
				last = client.JoinedAt
			}
			stale = append(stale, cached{id: id, last: last})
		}
	}
	sort.Slice(stale, func(i, j int) bool { return stale[i].last < stale[j].last })
	for _, item := range stale {
		if len(r.clients) <= limit {
			break
		}
		delete(r.clients, item.id)
	}
}
func (r *Room) positionLocked() { r.positionByIDsLocked(r.connectedIDsLocked()) }
func (r *Room) positionByIDsLocked(ids []string) {
	n := len(ids)
	for i, id := range ids {
		angle := float64(i)/float64(max(n, 1))*2*math.Pi - math.Pi/2
		r.clients[id].Position = model.Position{X: originX + radius*math.Cos(angle), Y: originY + radius*math.Sin(angle)}
	}
}
func (r *Room) hasSourceLocked(url string) bool {
	for _, s := range r.audioSources {
		if s.URL == url {
			return true
		}
	}
	return false
}
func (r *Room) scheduledTimeLocked(extra float64) float64 {
	maxRTT, maxComp := 0.0, 0.0
	for id := range r.connected {
		c := r.clients[id]
		if c.RTT > maxRTT {
			maxRTT = c.RTT
		}
		if c.CompensationMS > maxComp {
			maxComp = c.CompensationMS
		}
	}
	delay := math.Max(400, maxRTT*1.5+200)
	delay = math.Min(delay, 3000)
	return nowMS() + delay + maxComp + extra
}
func nowMS() float64 { return float64(time.Now().UnixNano()) / 1e6 }
func clamp(value, minValue, maxValue float64) float64 {
	return math.Max(minValue, math.Min(maxValue, value))
}

func TrackIDString(raw json.RawMessage) string {
	var value string
	if json.Unmarshal(raw, &value) == nil {
		return value
	}
	var number json.Number
	if json.Unmarshal(raw, &number) == nil {
		return number.String()
	}
	return ""
}
