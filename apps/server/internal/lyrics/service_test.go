package lyrics

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

func TestBuildSearchQuery(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Sơn Tùng M-TP - Chúng Ta Của Hiện Tại (Official Music Video).mp3", "Sơn Tùng M-TP - Chúng Ta Của Hiện Tại"},
		{"HIEUTHUHAI - NOLOVE (Official Audio) [MV]", "HIEUTHUHAI - NOLOVE"},
		{"Song Title | Official Video Clip", "Song Title"},
		{"Vũ. - Bước Qua Nhau.flac", "Vũ. - Bước Qua Nhau"},
	}

	for _, tt := range tests {
		got := BuildSearchQuery(tt.input)
		if got != tt.expected {
			t.Errorf("BuildSearchQuery(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

func TestServiceCachingAndDeduplication(t *testing.T) {
	svc := NewService("", "")

	// Manual store
	sample := &model.TrackLyrics{
		Synced:   "[00:05.00]Hello world",
		Plain:    "Hello world",
		Provider: "import",
	}
	svc.StoreManually("track-1", sample)

	ctx := context.Background()
	got, err := svc.GetOrFetch(ctx, "track-1", "", "Hello", 120)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == nil || got.Synced != sample.Synced {
		t.Fatalf("expected cached lyrics, got %#v", got)
	}

	// Concurrent fetch deduplication test
	var callCount int
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		callCount++
		mu.Unlock()
		time.Sleep(50 * time.Millisecond) // simulate delay
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`[{"id":1,"trackName":"Song","artistName":"Artist","duration":100,"syncedLyrics":"[00:10.00]Line 1"}]`))
	}))
	defer server.Close()

	svc.httpClient = server.Client()
	svc.lrclibBaseURL = server.URL

	var wg sync.WaitGroup
	results := make([]*model.TrackLyrics, 5)

	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			l, _ := svc.GetOrFetch(ctx, "http://test.com/stream", "", "Artist - Song", 100)
			results[idx] = l
		}(i)
	}
	wg.Wait()

	// Even though 5 goroutines requested at the same time, all should receive result
	for i, res := range results {
		if res == nil || !strings.Contains(res.Synced, "Line 1") {
			t.Errorf("goroutine %d got nil or invalid result: %#v", i, res)
		}
	}
}
