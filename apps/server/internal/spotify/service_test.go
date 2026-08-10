package spotify

import (
	"fmt"
	"testing"
)

func TestCollectEmbedTracksIsNotCappedAtFifty(t *testing.T) {
	items := make([]any, 75)
	for index := range items {
		items[index] = map[string]any{"id": fmt.Sprintf("track-%d", index), "type": "track", "name": fmt.Sprintf("Song %d", index), "subtitle": "Artist"}
	}
	entity := map[string]any{"deep": map[string]any{"playlist": map[string]any{"content": items}}}
	tracks := collectEmbedTracks(entity, "playlist")
	if len(tracks) != 75 {
		t.Fatalf("collected %d tracks, want 75", len(tracks))
	}
}
