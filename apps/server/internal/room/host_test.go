package room

import (
	"testing"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

func TestFirstClientBecomesAdmin(t *testing.T) {
	t.Parallel()
	r := New("test_room_1")

	clients, err := r.AddClient(model.Client{ClientID: "user1", Username: "Alice", JoinedAt: 100})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(clients) != 1 || !clients[0].IsAdmin {
		t.Fatalf("first client must be admin: %+v", clients)
	}

	// Second client should not be admin
	clients, err = r.AddClient(model.Client{ClientID: "user2", Username: "Bob", JoinedAt: 200})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(clients) != 2 {
		t.Fatalf("expected 2 clients, got %d", len(clients))
	}
	for _, c := range clients {
		if c.ClientID == "user1" && !c.IsAdmin {
			t.Errorf("user1 must remain admin")
		}
		if c.ClientID == "user2" && c.IsAdmin {
			t.Errorf("user2 must not be admin")
		}
	}
}

func TestCreatorIsAlwaysAdmin(t *testing.T) {
	t.Parallel()
	r := New("test_room_creator")

	// First normal client
	_, _ = r.AddClient(model.Client{ClientID: "user1", Username: "Alice", JoinedAt: 100})

	// Second client is creator
	clients, _ := r.AddClient(model.Client{ClientID: "creator", Username: "Freeman", IsCreator: true, JoinedAt: 200})
	foundCreator := false
	for _, c := range clients {
		if c.ClientID == "creator" {
			foundCreator = true
			if !c.IsAdmin {
				t.Errorf("creator must have admin permissions")
			}
		}
	}
	if !foundCreator {
		t.Fatal("creator client not found")
	}
}

func TestAdminPromotionWhenHostLeaves(t *testing.T) {
	t.Parallel()
	r := New("test_room_promo")

	_, _ = r.AddClient(model.Client{ClientID: "user1", Username: "Alice", JoinedAt: 100})
	_, _ = r.AddClient(model.Client{ClientID: "user2", Username: "Bob", JoinedAt: 200})
	_, _ = r.AddClient(model.Client{ClientID: "user3", Username: "Charlie", JoinedAt: 300})

	// User1 (admin) leaves
	remaining := r.RemoveClient("user1")
	if len(remaining) != 2 {
		t.Fatalf("expected 2 remaining clients, got %d", len(remaining))
	}

	// Oldest remaining client (user2 with JoinedAt: 200) should be promoted
	for _, c := range remaining {
		if c.ClientID == "user2" && !c.IsAdmin {
			t.Errorf("user2 should have been promoted to admin")
		}
		if c.ClientID == "user3" && c.IsAdmin {
			t.Errorf("user3 should not be admin")
		}
	}
}

func TestSetAdminTransfer(t *testing.T) {
	t.Parallel()
	r := New("test_room_transfer")

	_, _ = r.AddClient(model.Client{ClientID: "user1", Username: "Alice", JoinedAt: 100})
	_, _ = r.AddClient(model.Client{ClientID: "user2", Username: "Bob", JoinedAt: 200})

	clients, ok := r.SetAdmin("user2", true)
	if !ok {
		t.Fatal("SetAdmin failed")
	}
	for _, c := range clients {
		if c.ClientID == "user2" && !c.IsAdmin {
			t.Errorf("user2 must now be admin")
		}
	}

	clients, ok = r.SetAdmin("user1", false)
	if !ok {
		t.Fatal("SetAdmin demote failed")
	}
	for _, c := range clients {
		if c.ClientID == "user1" && c.IsAdmin {
			t.Errorf("user1 must no longer be admin")
		}
	}
}

func TestPlaybackControlsAndCanMutate(t *testing.T) {
	t.Parallel()
	r := New("test_room_perms")

	_, _ = r.AddClient(model.Client{ClientID: "host", Username: "Alice", JoinedAt: 100})
	_, _ = r.AddClient(model.Client{ClientID: "guest", Username: "Bob", JoinedAt: 200})

	// Default is ADMIN_ONLY
	if r.PlaybackControls() != "ADMIN_ONLY" {
		t.Fatalf("expected default PlaybackControls to be ADMIN_ONLY, got %s", r.PlaybackControls())
	}
	if !r.CanMutate("host") {
		t.Error("host must be able to mutate in ADMIN_ONLY mode")
	}
	if r.CanMutate("guest") {
		t.Error("guest must NOT be able to mutate in ADMIN_ONLY mode")
	}

	// Switch to EVERYONE
	perm, ok := r.SetPlaybackControls("EVERYONE")
	if !ok || perm != "EVERYONE" {
		t.Fatalf("failed to set playback controls to EVERYONE: %v, %s", ok, perm)
	}
	if !r.CanMutate("host") {
		t.Error("host must be able to mutate in EVERYONE mode")
	}
	if !r.CanMutate("guest") {
		t.Error("guest must be able to mutate in EVERYONE mode")
	}

	// Switch back to ADMIN_ONLY
	perm, ok = r.SetPlaybackControls("ADMIN_ONLY")
	if !ok || perm != "ADMIN_ONLY" {
		t.Fatalf("failed to set playback controls to ADMIN_ONLY: %v, %s", ok, perm)
	}
	if r.CanMutate("guest") {
		t.Error("guest must NOT be able to mutate once back to ADMIN_ONLY mode")
	}
}
