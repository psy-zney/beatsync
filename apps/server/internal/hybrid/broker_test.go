package hybrid

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func newBrokerServer(t *testing.T, secret string) (*Broker, *httptest.Server) {
	t.Helper()
	broker := NewBroker(secret)
	server := httptest.NewServer(http.HandlerFunc(broker.ServeHTTP))
	t.Cleanup(func() {
		broker.Close()
		server.Close()
	})
	return broker, server
}

func dialWorker(t *testing.T, serverURL, secret, workerID string, capacity int) *websocket.Conn {
	t.Helper()
	endpoint := "ws" + strings.TrimPrefix(serverURL, "http") + "/?workerId=" + workerID + "&capacity=" + strconv.Itoa(capacity)
	header := http.Header{"Authorization": []string{"Bearer " + secret}}
	connection, response, err := websocket.DefaultDialer.Dial(endpoint, header)
	if err != nil {
		status := 0
		if response != nil {
			status = response.StatusCode
		}
		t.Fatalf("dial worker: status=%d err=%v", status, err)
	}
	t.Cleanup(func() { connection.Close() })
	_ = connection.SetReadDeadline(time.Now().Add(3 * time.Second))
	var ready Message
	if err := connection.ReadJSON(&ready); err != nil || ready.Type != "ready" {
		t.Fatalf("ready message=%+v err=%v", ready, err)
	}
	return connection
}

func TestBrokerRejectsMissingOrInvalidCredentials(t *testing.T) {
	t.Parallel()
	_, server := newBrokerServer(t, "correct-secret")
	endpoint := "ws" + strings.TrimPrefix(server.URL, "http") + "/?workerId=local&capacity=1"

	for _, test := range []struct {
		name   string
		header http.Header
	}{
		{name: "missing"},
		{name: "wrong", header: http.Header{"Authorization": []string{"Bearer wrong-secret"}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, response, err := websocket.DefaultDialer.Dial(endpoint, test.header)
			if err == nil || response == nil || response.StatusCode != http.StatusUnauthorized {
				t.Fatalf("response=%v err=%v, want HTTP 401", response, err)
			}
		})
	}
}

func TestBrokerDispatchesAndReturnsTypedResult(t *testing.T) {
	t.Parallel()
	broker, server := newBrokerServer(t, "secret")
	worker := dialWorker(t, server.URL, "secret", "desktop", 2)

	workerErr := make(chan error, 1)
	go func() {
		var job Message
		if err := worker.ReadJSON(&job); err != nil {
			workerErr <- err
			return
		}
		var input YouTubeSearchInput
		if err := json.Unmarshal(job.Payload, &input); err != nil {
			workerErr <- err
			return
		}
		if job.Type != "job" || job.Kind != KindYouTubeSearch || input.Query != "ambient" || job.DeadlineUnixMS == 0 {
			workerErr <- errors.New("unexpected job payload")
			return
		}
		payload, _ := json.Marshal(map[string]any{"source": "local", "offset": input.Offset})
		workerErr <- worker.WriteJSON(Message{Type: "result", JobID: job.JobID, Result: payload})
	}()

	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	var output map[string]any
	if err := broker.Dispatch(ctx, KindYouTubeSearch, YouTubeSearchInput{Query: "ambient", Offset: 2}, &output); err != nil {
		t.Fatal(err)
	}
	if err := <-workerErr; err != nil {
		t.Fatal(err)
	}
	if output["source"] != "local" || output["offset"] != float64(2) {
		t.Fatalf("output=%#v", output)
	}
	stats := broker.Stats(7)
	if stats.Workers != 1 || stats.Capacity != 2 || stats.Inflight != 0 || stats.PendingOnVPS != 7 {
		t.Fatalf("stats=%+v", stats)
	}
}

func TestBrokerCapacityFallsBackAndDisconnectReturnsLease(t *testing.T) {
	t.Parallel()
	broker, server := newBrokerServer(t, "secret")
	worker := dialWorker(t, server.URL, "secret", "desktop", 1)

	firstResult := make(chan error, 1)
	go func() {
		firstResult <- broker.Dispatch(t.Context(), KindYouTubeResolve, YouTubeInput{Input: "video"}, nil)
	}()
	var leased Message
	if err := worker.ReadJSON(&leased); err != nil || leased.Type != "job" {
		t.Fatalf("leased=%+v err=%v", leased, err)
	}

	if err := broker.Dispatch(t.Context(), KindYouTubeSearch, YouTubeSearchInput{Query: "fallback"}, nil); !errors.Is(err, ErrWorkerUnavailable) {
		t.Fatalf("capacity error=%v, want ErrWorkerUnavailable", err)
	}
	if err := worker.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-firstResult:
		if !errors.Is(err, ErrWorkerUnavailable) {
			t.Fatalf("disconnect error=%v, want ErrWorkerUnavailable", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("leased job was not returned after worker disconnect")
	}
}

func TestWorkerEndpointNormalization(t *testing.T) {
	t.Parallel()
	tests := []struct {
		input string
		want  string
	}{
		{input: "https://api.example.com", want: "wss://api.example.com/internal/worker?capacity=2&workerId=pc"},
		{input: "http://127.0.0.1:1001/custom", want: "ws://127.0.0.1:1001/custom?capacity=2&workerId=pc"},
	}
	for _, test := range tests {
		got, err := workerEndpoint(test.input, "pc", 2)
		if err != nil || got != test.want {
			t.Fatalf("workerEndpoint(%q)=%q, %v; want %q", test.input, got, err, test.want)
		}
	}
}
