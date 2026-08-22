package realtime

import (
	"testing"
	"time"
)

func TestNTPRateLimiterAllowsProbePairAndCapsBurst(t *testing.T) {
	t.Parallel()
	client := NewClient("room", "client", "Alice", false, nil)
	start := client.ntpLastRefill

	for request := 0; request < int(ntpTokenCapacity); request++ {
		if !client.AllowNTP(start) {
			t.Fatalf("request %d was rejected inside burst capacity", request+1)
		}
	}
	if client.AllowNTP(start) {
		t.Fatal("request above burst capacity was accepted")
	}

	// Four tokens/second means half a second restores one complete pair.
	refilledAt := start.Add(500 * time.Millisecond)
	if !client.AllowNTP(refilledAt) || !client.AllowNTP(refilledAt) {
		t.Fatal("a probe pair was not restored after token refill")
	}
	if client.AllowNTP(refilledAt) {
		t.Fatal("refill created more tokens than expected")
	}
}

func TestHubReplacementAndExactUnregister(t *testing.T) {
	t.Parallel()
	hub := NewHub()
	oldClient := NewClient("room", "same-id", "Old", false, nil)
	newClient := NewClient("room", "same-id", "New", false, nil)
	hub.Register(oldClient)
	hub.Register(newClient)

	select {
	case <-oldClient.done:
	default:
		t.Fatal("replaced connection was not closed")
	}
	if removed := hub.Unregister(oldClient); removed {
		t.Fatal("stale connection unregistered its replacement")
	}
	if hub.Count("room") != 1 || !hub.Send("room", "same-id", map[string]string{"type": "hello"}) {
		t.Fatal("replacement is not reachable")
	}
	select {
	case payload := <-newClient.send:
		if string(payload) != `{"type":"hello"}` {
			t.Fatalf("payload=%s", payload)
		}
	default:
		t.Fatal("unicast was not queued")
	}
	if removed := hub.Unregister(newClient); !removed || hub.Count("room") != 0 {
		t.Fatalf("removed=%v count=%d", removed, hub.Count("room"))
	}
}

func TestHubBroadcastAndCloseAllClients(t *testing.T) {
	t.Parallel()
	hub := NewHub()
	clients := []*Client{
		NewClient("room", "one", "One", false, nil),
		NewClient("room", "two", "Two", false, nil),
	}
	for _, client := range clients {
		hub.Register(client)
	}
	hub.Broadcast("room", map[string]any{"type": "event", "count": 2})
	for _, client := range clients {
		select {
		case payload := <-client.send:
			if string(payload) != `{"count":2,"type":"event"}` {
				t.Fatalf("payload=%s", payload)
			}
		default:
			t.Fatalf("client %s missed broadcast", client.ClientID)
		}
	}
	hub.Close()
	if hub.Count("room") != 0 {
		t.Fatal("hub retained clients after close")
	}
	for _, client := range clients {
		select {
		case <-client.done:
		default:
			t.Fatalf("client %s was not closed", client.ClientID)
		}
	}
}

func TestClientBackpressureIsBoundedAndFailClosed(t *testing.T) {
	t.Parallel()
	client := NewClient("room", "slow", "Slow", false, nil)
	for index := 0; index < sendQueueCapacity; index++ {
		if !client.SendBytes([]byte("message")) {
			t.Fatalf("queue rejected item %d inside capacity", index)
		}
	}
	if client.SendBytes([]byte("overflow")) {
		t.Fatal("queue accepted an item above its bounded capacity")
	}
	select {
	case <-client.done:
	default:
		t.Fatal("chronically slow client was not disconnected")
	}
}
