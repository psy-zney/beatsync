package realtime

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeTimeout       = 10 * time.Second
	pongTimeout        = 100 * time.Second
	pingInterval       = 45 * time.Second
	ntpTokenCapacity   = 4.0
	ntpTokensPerSecond = 4.0
	sendQueueCapacity  = 64
)

type Client struct {
	RoomID    string
	ClientID  string
	Username  string
	IsCreator bool
	Conn      *websocket.Conn

	send chan []byte
	done chan struct{}
	once sync.Once

	ntpMu         sync.Mutex
	ntpTokens     float64
	ntpLastRefill time.Time
}

func NewClient(roomID, clientID, username string, creator bool, conn *websocket.Conn) *Client {
	now := time.Now()
	return &Client{
		RoomID: roomID, ClientID: clientID, Username: username, IsCreator: creator,
		Conn: conn, send: make(chan []byte, sendQueueCapacity), done: make(chan struct{}),
		ntpTokens: ntpTokenCapacity, ntpLastRefill: now,
	}
}

// AllowNTP caps work per connection while retaining enough burst capacity for
// one coded probe pair. WebSocket control pings continue to handle liveness.
func (c *Client) AllowNTP(now time.Time) bool {
	c.ntpMu.Lock()
	defer c.ntpMu.Unlock()
	if elapsed := now.Sub(c.ntpLastRefill).Seconds(); elapsed > 0 {
		c.ntpTokens += elapsed * ntpTokensPerSecond
		if c.ntpTokens > ntpTokenCapacity {
			c.ntpTokens = ntpTokenCapacity
		}
		c.ntpLastRefill = now
	}
	if c.ntpTokens < 1 {
		return false
	}
	c.ntpTokens--
	return true
}

func (c *Client) StartWriter() { go c.writePump() }

func (c *Client) ReadPump(maxMessageBytes int64, onMessage func([]byte)) {
	defer c.Close()
	c.Conn.SetReadLimit(maxMessageBytes)
	_ = c.Conn.SetReadDeadline(time.Now().Add(pongTimeout))
	c.Conn.SetPongHandler(func(string) error { return c.Conn.SetReadDeadline(time.Now().Add(pongTimeout)) })
	for {
		kind, payload, err := c.Conn.ReadMessage()
		if err != nil {
			return
		}
		if kind == websocket.TextMessage {
			onMessage(payload)
		}
	}
}

func (c *Client) Send(value any) bool {
	payload, err := json.Marshal(value)
	if err != nil {
		return false
	}
	return c.SendBytes(payload)
}

func (c *Client) SendBytes(payload []byte) bool {
	select {
	case <-c.done:
		return false
	default:
	}
	select {
	case c.send <- payload:
		return true
	case <-c.done:
		return false
	default:
		c.Close()
		return false
	}
}

func (c *Client) Close() {
	c.once.Do(func() {
		close(c.done)
		if c.Conn != nil {
			_ = c.Conn.Close()
		}
	})
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()
	for {
		select {
		case payload := <-c.send:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := c.Conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				c.Close()
				return
			}
		case <-ticker.C:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := c.Conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeTimeout)); err != nil {
				c.Close()
				return
			}
		case <-c.done:
			return
		}
	}
}

type Hub struct {
	mu    sync.RWMutex
	rooms map[string]map[string]*Client
}

func NewHub() *Hub { return &Hub{rooms: make(map[string]map[string]*Client)} }

func (h *Hub) Register(client *Client) {
	h.mu.Lock()
	room := h.rooms[client.RoomID]
	if room == nil {
		room = make(map[string]*Client)
		h.rooms[client.RoomID] = room
	}
	previous := room[client.ClientID]
	room[client.ClientID] = client
	h.mu.Unlock()
	if previous != nil && previous != client {
		previous.Close()
	}
}

func (h *Hub) Unregister(client *Client) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	clients := h.rooms[client.RoomID]
	if clients == nil || clients[client.ClientID] != client {
		return false
	}
	delete(clients, client.ClientID)
	if len(clients) == 0 {
		delete(h.rooms, client.RoomID)
	}
	return true
}

func (h *Hub) Broadcast(roomID string, value any) {
	payload, err := json.Marshal(value)
	if err != nil {
		log.Printf("marshal WebSocket broadcast: %v", err)
		return
	}
	h.mu.RLock()
	clients := make([]*Client, 0, len(h.rooms[roomID]))
	for _, client := range h.rooms[roomID] {
		clients = append(clients, client)
	}
	h.mu.RUnlock()
	for _, client := range clients {
		client.SendBytes(payload)
	}
}

func (h *Hub) Send(roomID, clientID string, value any) bool {
	h.mu.RLock()
	client := h.rooms[roomID][clientID]
	h.mu.RUnlock()
	return client != nil && client.Send(value)
}

func (h *Hub) Count(roomID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms[roomID])
}

func (h *Hub) Close() {
	h.mu.Lock()
	clients := make([]*Client, 0)
	for _, room := range h.rooms {
		for _, client := range room {
			clients = append(clients, client)
		}
	}
	h.rooms = make(map[string]map[string]*Client)
	h.mu.Unlock()
	for _, client := range clients {
		client.Close()
	}
}
