package room

import (
	"fmt"
	"testing"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

func setLastActivity(t *testing.T, state *Room, value time.Time) {
	t.Helper()
	state.mu.Lock()
	state.lastActivity = value
	state.mu.Unlock()
}

func TestCleanupIdleRemovesOnlyExpiredEmptyRooms(t *testing.T) {
	t.Parallel()
	manager := NewManager()
	expired := manager.GetOrCreate("expired")
	fresh := manager.GetOrCreate("fresh")
	active := manager.GetOrCreate("active")
	setLastActivity(t, expired, time.Now().Add(-2*time.Hour))
	setLastActivity(t, fresh, time.Now())
	addTestClients(t, active, "listener")
	setLastActivity(t, active, time.Now().Add(-2*time.Hour))

	cleaned := make([]string, 0, 1)
	removed := manager.CleanupIdle(time.Hour, func(state *Room) { cleaned = append(cleaned, state.ID) })
	if removed != 1 || len(cleaned) != 1 || cleaned[0] != "expired" {
		t.Fatalf("removed=%d cleaned=%v", removed, cleaned)
	}
	if _, ok := manager.Get("expired"); ok {
		t.Fatal("expired room still exists")
	}
	if _, ok := manager.Get("fresh"); !ok {
		t.Fatal("fresh room was removed")
	}
	if _, ok := manager.Get("active"); !ok {
		t.Fatal("active room was removed")
	}
}

func TestRejoinRefreshesRoomActivity(t *testing.T) {
	t.Parallel()
	manager := NewManager()
	state := manager.GetOrCreate("rejoin")
	setLastActivity(t, state, time.Now().Add(-2*time.Hour))
	addTestClients(t, state, "returning")
	state.RemoveClient("returning")

	if removed := manager.CleanupIdle(time.Hour, func(*Room) {}); removed != 0 {
		t.Fatalf("removed=%d, want 0 after rejoin activity", removed)
	}
}

func TestDiscoverReturnsOnlyFiftyMostPopulatedActiveRooms(t *testing.T) {
	t.Parallel()
	manager := NewManager()
	manager.GetOrCreate("empty")
	for index := 0; index < 55; index++ {
		state := manager.GetOrCreate(fmt.Sprintf("room-%02d", index))
		addTestClients(t, state, fmt.Sprintf("client-%02d", index))
	}
	crowded := manager.GetOrCreate("crowded")
	addTestClients(t, crowded, "one", "two", "three")

	discovered := manager.Discover()
	if len(discovered) != 50 {
		t.Fatalf("discovered=%d, want 50", len(discovered))
	}
	if discovered[0]["roomId"] != "crowded" {
		t.Fatalf("first room=%v, want crowded", discovered[0]["roomId"])
	}
	for _, item := range discovered {
		clients, ok := item["clients"].([]model.Client)
		if !ok || len(clients) == 0 {
			t.Fatalf("inactive discovery item: %#v", item)
		}
	}
}
