package hybrid

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/psy-zney/beatsync/apps/server/internal/config"
	"github.com/psy-zney/beatsync/apps/server/internal/spotify"
	"github.com/psy-zney/beatsync/apps/server/internal/youtube"
)

const agentHeartbeatInterval = 10 * time.Second

type Agent struct {
	cfg     config.Config
	spotify *spotify.Service
	youtube *youtube.Service
}

func NewAgent(cfg config.Config) *Agent {
	return &Agent{cfg: cfg, spotify: spotify.New(cfg), youtube: youtube.New(cfg)}
}

// Run maintains one outbound connection to the VPS. A disconnect cancels all
// leased work so the broker can immediately fall back to its local services.
func (a *Agent) Run(ctx context.Context) error {
	if _, err := workerEndpoint(a.cfg.WorkerServerURL, a.cfg.WorkerID, a.cfg.WorkerConcurrency); err != nil {
		return err
	}
	backoff := time.Second
	for ctx.Err() == nil {
		err := a.runSession(ctx)
		if ctx.Err() != nil {
			return nil
		}
		log.Printf("hybrid worker disconnected: %v; retrying in %s", err, backoff)
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
		backoff *= 2
		if backoff > 30*time.Second {
			backoff = 30 * time.Second
		}
	}
	return nil
}

func (a *Agent) runSession(parent context.Context) error {
	endpoint, err := workerEndpoint(a.cfg.WorkerServerURL, a.cfg.WorkerID, a.cfg.WorkerConcurrency)
	if err != nil {
		return err
	}
	header := http.Header{"Authorization": []string{"Bearer " + a.cfg.HybridWorkerSecret}}
	if a.cfg.WorkerAccessClientID != "" {
		header.Set("CF-Access-Client-Id", a.cfg.WorkerAccessClientID)
		header.Set("CF-Access-Client-Secret", a.cfg.WorkerAccessClientSecret)
	}
	connection, response, err := websocket.DefaultDialer.DialContext(parent, endpoint, header)
	if err != nil {
		if response != nil {
			return fmt.Errorf("connect worker endpoint: HTTP %d: %w", response.StatusCode, err)
		}
		return fmt.Errorf("connect worker endpoint: %w", err)
	}
	defer connection.Close()
	log.Printf("hybrid worker connected: id=%s capacity=%d", a.cfg.WorkerID, a.cfg.WorkerConcurrency)

	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	send := make(chan Message, a.cfg.WorkerConcurrency*2+4)
	writerDone := make(chan error, 1)
	go func() { writerDone <- agentWritePump(ctx, connection, send) }()
	go func() {
		<-ctx.Done()
		_ = connection.Close()
	}()

	semaphore := make(chan struct{}, a.cfg.WorkerConcurrency)
	var jobs sync.WaitGroup
	for {
		var message Message
		if err := connection.ReadJSON(&message); err != nil {
			cancel()
			jobs.Wait()
			select {
			case writerErr := <-writerDone:
				if writerErr != nil && !errors.Is(writerErr, context.Canceled) {
					return writerErr
				}
			default:
			}
			return err
		}
		if message.Type != "job" || message.JobID == "" {
			continue
		}
		jobs.Add(1)
		go func(job Message) {
			defer jobs.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				return
			}
			resultMessage := a.execute(ctx, job)
			select {
			case send <- resultMessage:
			case <-ctx.Done():
			}
		}(message)
	}
}

func (a *Agent) execute(parent context.Context, job Message) Message {
	ctx := parent
	cancel := func() {}
	if job.DeadlineUnixMS > 0 {
		ctx, cancel = context.WithDeadline(parent, time.UnixMilli(job.DeadlineUnixMS))
	}
	defer cancel()
	value, err := a.handle(ctx, job.Kind, job.Payload)
	response := Message{Type: "result", JobID: job.JobID}
	if err != nil {
		response.Error = err.Error()
		if len(response.Error) > 500 {
			response.Error = response.Error[:500]
		}
		return response
	}
	response.Result, err = json.Marshal(value)
	if err != nil {
		response.Error = "encode result: " + err.Error()
	}
	return response
}

func (a *Agent) handle(ctx context.Context, kind string, payload json.RawMessage) (any, error) {
	switch kind {
	case KindSpotifyResolve:
		var input SpotifyResolveInput
		if err := json.Unmarshal(payload, &input); err != nil {
			return nil, err
		}
		return a.spotify.Resolve(ctx, input.URL, input.MaxTracks)
	case KindYouTubeSearch:
		var input YouTubeSearchInput
		if err := json.Unmarshal(payload, &input); err != nil {
			return nil, err
		}
		return a.youtube.Search(ctx, input.Query, input.Offset)
	case KindYouTubeResolve:
		var input YouTubeInput
		if err := json.Unmarshal(payload, &input); err != nil {
			return nil, err
		}
		return a.youtube.Resolve(ctx, input.Input)
	case KindYouTubeMetadata:
		var input YouTubeInput
		if err := json.Unmarshal(payload, &input); err != nil {
			return nil, err
		}
		title, videoID, err := a.youtube.Metadata(ctx, input.Input)
		return YouTubeMetadataResult{Title: title, VideoID: videoID}, err
	default:
		return nil, fmt.Errorf("unsupported job kind %q", kind)
	}
}

func agentWritePump(ctx context.Context, connection *websocket.Conn, send <-chan Message) error {
	ticker := time.NewTicker(agentHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case message := <-send:
			_ = connection.SetWriteDeadline(time.Now().Add(workerWriteTimeout))
			if err := connection.WriteJSON(message); err != nil {
				return err
			}
		case <-ticker.C:
			_ = connection.SetWriteDeadline(time.Now().Add(workerWriteTimeout))
			if err := connection.WriteJSON(Message{Type: "heartbeat"}); err != nil {
				return err
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func workerEndpoint(raw, workerID string, capacity int) (string, error) {
	endpoint, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", err
	}
	switch endpoint.Scheme {
	case "https":
		endpoint.Scheme = "wss"
	case "http":
		endpoint.Scheme = "ws"
	case "ws", "wss":
	default:
		return "", errors.New("WORKER_SERVER_URL must use http(s) or ws(s)")
	}
	if endpoint.Host == "" {
		return "", errors.New("WORKER_SERVER_URL must include a host")
	}
	if endpoint.Path == "" || endpoint.Path == "/" {
		endpoint.Path = "/internal/worker"
	}
	query := endpoint.Query()
	query.Set("workerId", workerID)
	query.Set("capacity", fmt.Sprint(capacity))
	endpoint.RawQuery = query.Encode()
	return endpoint.String(), nil
}
