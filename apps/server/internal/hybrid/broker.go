package hybrid

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const (
	workerWriteTimeout = 10 * time.Second
	workerPongTimeout  = 35 * time.Second
	workerPingInterval = 15 * time.Second
	workerSendQueue    = 64
)

var workerIDPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)

type result struct {
	payload json.RawMessage
	err     error
}

type pendingJob struct {
	worker *workerConn
	result chan result
}

type workerConn struct {
	id       string
	capacity int
	conn     *websocket.Conn
	send     chan Message
	done     chan struct{}
	once     sync.Once
	inflight int
	seenAt   time.Time
}

func (w *workerConn) close() {
	w.once.Do(func() {
		close(w.done)
		_ = w.conn.Close()
	})
}

type Stats struct {
	Enabled      bool `json:"enabled"`
	Workers      int  `json:"workers"`
	Capacity     int  `json:"capacity"`
	Inflight     int  `json:"inflight"`
	PendingOnVPS int  `json:"pendingOnVps"`
}

type Broker struct {
	secret   string
	upgrader websocket.Upgrader
	mu       sync.Mutex
	workers  map[string]*workerConn
	pending  map[string]pendingJob
	sequence atomic.Uint64
	closed   bool
}

func NewBroker(secret string) *Broker {
	return &Broker{
		secret: strings.TrimSpace(secret), workers: make(map[string]*workerConn), pending: make(map[string]pendingJob),
		upgrader: websocket.Upgrader{ReadBufferSize: 1024, WriteBufferSize: 2048, CheckOrigin: func(*http.Request) bool { return true }},
	}
}

func (b *Broker) Enabled() bool { return b.secret != "" }

func (b *Broker) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if !b.Enabled() {
		http.NotFound(writer, request)
		return
	}
	provided := strings.TrimSpace(strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer "))
	if len(provided) != len(b.secret) || subtle.ConstantTimeCompare([]byte(provided), []byte(b.secret)) != 1 {
		http.Error(writer, "unauthorized", http.StatusUnauthorized)
		return
	}
	workerID := request.URL.Query().Get("workerId")
	if !workerIDPattern.MatchString(workerID) {
		http.Error(writer, "invalid workerId", http.StatusBadRequest)
		return
	}
	capacity, err := strconv.Atoi(request.URL.Query().Get("capacity"))
	if err != nil || capacity < 1 || capacity > 32 {
		http.Error(writer, "invalid capacity", http.StatusBadRequest)
		return
	}
	connection, err := b.upgrader.Upgrade(writer, request, nil)
	if err != nil {
		return
	}
	worker := &workerConn{id: workerID, capacity: capacity, conn: connection, send: make(chan Message, workerSendQueue), done: make(chan struct{}), seenAt: time.Now()}
	b.register(worker)
	log.Printf("hybrid worker connected: id=%s capacity=%d", worker.id, worker.capacity)
	go b.writePump(worker)
	select {
	case worker.send <- Message{Type: "ready"}:
	case <-worker.done:
		b.unregister(worker, ErrWorkerUnavailable)
		return
	}
	b.readPump(worker)
	b.unregister(worker, ErrWorkerUnavailable)
	log.Printf("hybrid worker disconnected: id=%s", worker.id)
}

func (b *Broker) Dispatch(ctx context.Context, kind string, input, output any) error {
	payload, err := json.Marshal(input)
	if err != nil {
		return fmt.Errorf("encode hybrid job: %w", err)
	}
	jobID := fmt.Sprintf("%d-%d", time.Now().UnixMilli(), b.sequence.Add(1))
	resultChannel := make(chan result, 1)

	b.mu.Lock()
	worker := b.pickWorkerLocked()
	if worker == nil {
		b.mu.Unlock()
		return ErrWorkerUnavailable
	}
	worker.inflight++
	b.pending[jobID] = pendingJob{worker: worker, result: resultChannel}
	b.mu.Unlock()

	deadline := time.Now().Add(30 * time.Second).UnixMilli()
	if value, ok := ctx.Deadline(); ok {
		deadline = value.UnixMilli()
	}
	message := Message{Type: "job", JobID: jobID, Kind: kind, Payload: payload, DeadlineUnixMS: deadline}
	select {
	case worker.send <- message:
	case <-worker.done:
		b.cancel(jobID)
		return ErrWorkerUnavailable
	case <-ctx.Done():
		b.cancel(jobID)
		return ctx.Err()
	}

	select {
	case completed := <-resultChannel:
		if completed.err != nil {
			return completed.err
		}
		if output == nil || len(completed.payload) == 0 {
			return nil
		}
		if err := json.Unmarshal(completed.payload, output); err != nil {
			return fmt.Errorf("decode hybrid result: %w", err)
		}
		return nil
	case <-worker.done:
		b.cancel(jobID)
		return ErrWorkerUnavailable
	case <-ctx.Done():
		b.cancel(jobID)
		return ctx.Err()
	}
}

func (b *Broker) Stats(vpsPending int) Stats {
	b.mu.Lock()
	defer b.mu.Unlock()
	stats := Stats{Enabled: b.Enabled(), Workers: len(b.workers), PendingOnVPS: vpsPending}
	for _, worker := range b.workers {
		stats.Capacity += worker.capacity
		stats.Inflight += worker.inflight
	}
	return stats
}

func (b *Broker) Close() {
	b.mu.Lock()
	b.closed = true
	workers := make([]*workerConn, 0, len(b.workers))
	for _, worker := range b.workers {
		workers = append(workers, worker)
	}
	b.mu.Unlock()
	for _, worker := range workers {
		worker.close()
		b.unregister(worker, ErrWorkerUnavailable)
	}
}

func (b *Broker) register(worker *workerConn) {
	b.mu.Lock()
	previous := b.workers[worker.id]
	if b.closed {
		b.mu.Unlock()
		worker.close()
		return
	}
	b.workers[worker.id] = worker
	b.mu.Unlock()
	if previous != nil && previous != worker {
		previous.close()
		b.unregister(previous, ErrWorkerUnavailable)
	}
}

func (b *Broker) unregister(worker *workerConn, cause error) {
	worker.close()
	b.mu.Lock()
	if b.workers[worker.id] == worker {
		delete(b.workers, worker.id)
	}
	failed := make([]chan result, 0)
	for jobID, pending := range b.pending {
		if pending.worker == worker {
			delete(b.pending, jobID)
			failed = append(failed, pending.result)
		}
	}
	worker.inflight = 0
	b.mu.Unlock()
	for _, channel := range failed {
		channel <- result{err: cause}
	}
}

func (b *Broker) pickWorkerLocked() *workerConn {
	var selected *workerConn
	for _, worker := range b.workers {
		if worker.inflight >= worker.capacity {
			continue
		}
		if selected == nil || worker.inflight < selected.inflight {
			selected = worker
		}
	}
	return selected
}

func (b *Broker) cancel(jobID string) {
	b.mu.Lock()
	if pending, ok := b.pending[jobID]; ok {
		delete(b.pending, jobID)
		if pending.worker.inflight > 0 {
			pending.worker.inflight--
		}
	}
	b.mu.Unlock()
}

func (b *Broker) complete(worker *workerConn, message Message) {
	b.mu.Lock()
	pending, ok := b.pending[message.JobID]
	if ok && pending.worker == worker {
		delete(b.pending, message.JobID)
		if worker.inflight > 0 {
			worker.inflight--
		}
	} else {
		ok = false
	}
	b.mu.Unlock()
	if !ok {
		return
	}
	if message.Error != "" {
		pending.result <- result{err: &RemoteError{Message: message.Error}}
		return
	}
	pending.result <- result{payload: message.Result}
}

func (b *Broker) readPump(worker *workerConn) {
	worker.conn.SetReadLimit(2 << 20)
	_ = worker.conn.SetReadDeadline(time.Now().Add(workerPongTimeout))
	worker.conn.SetPongHandler(func(string) error { return worker.conn.SetReadDeadline(time.Now().Add(workerPongTimeout)) })
	for {
		var message Message
		if err := worker.conn.ReadJSON(&message); err != nil {
			return
		}
		_ = worker.conn.SetReadDeadline(time.Now().Add(workerPongTimeout))
		b.mu.Lock()
		worker.seenAt = time.Now()
		b.mu.Unlock()
		if message.Type == "result" && message.JobID != "" {
			b.complete(worker, message)
		}
	}
}

func (b *Broker) writePump(worker *workerConn) {
	ticker := time.NewTicker(workerPingInterval)
	defer ticker.Stop()
	for {
		select {
		case message := <-worker.send:
			_ = worker.conn.SetWriteDeadline(time.Now().Add(workerWriteTimeout))
			if err := worker.conn.WriteJSON(message); err != nil {
				worker.close()
				return
			}
		case <-ticker.C:
			if err := worker.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(workerWriteTimeout)); err != nil {
				worker.close()
				return
			}
		case <-worker.done:
			return
		}
	}
}
