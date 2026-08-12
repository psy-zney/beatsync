package youtube

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/psy-zney/beatsync/apps/server/internal/config"
)

func TestParseVideoID(t *testing.T) {
	t.Parallel()
	want := "dQw4w9WgXcQ"
	for _, input := range []string{want, "https://youtu.be/" + want, "https://www.youtube.com/watch?v=" + want, "youtube.com/shorts/" + want} {
		if got := ParseVideoID(input); got != want {
			t.Fatalf("ParseVideoID(%q) = %q, want %q", input, got, want)
		}
	}
	for _, input := range []string{"", "https://example.com/watch?v=" + want, "../bad"} {
		if got := ParseVideoID(input); got != "" {
			t.Fatalf("accepted invalid input %q", input)
		}
	}
}

func TestTrustedMediaURL(t *testing.T) {
	t.Parallel()
	if !TrustedMediaURL("https://r1---sn.example.googlevideo.com/videoplayback?id=x") {
		t.Fatal("expected googlevideo URL to be trusted")
	}
	for _, raw := range []string{"file:///etc/passwd", "https://googlevideo.com.evil.test/x", "https://example.com/x"} {
		if TrustedMediaURL(raw) {
			t.Fatalf("trusted unsafe URL %q", raw)
		}
	}
}

func TestCachedVideoIDAndTitleHealing(t *testing.T) {
	t.Parallel()
	url := "https://cdn.test/youtube-cache/dQw4w9WgXcQ.webm"
	if got := CachedVideoID(url); got != "dQw4w9WgXcQ" {
		t.Fatalf("CachedVideoID=%q", got)
	}
	if !NeedsTitleHeal(url, "YouTube Audio") || NeedsTitleHeal(url, "Resolved title") {
		t.Fatal("unexpected title healing decision")
	}
}

func TestParseSearchPageFiltersAndPreservesMetadata(t *testing.T) {
	t.Parallel()
	page := []byte(`<html><script>var ytInitialData = {"contents":[
		{"videoRenderer":{"videoId":"dQw4w9WgXcQ","title":{"runs":[{"text":"Song &amp; Mix"}]},"lengthText":{"simpleText":"3:32"},"ownerText":{"runs":[{"text":"Artist"}]},"thumbnail":{"thumbnails":[{"url":"small"},{"url":"large"}]}}},
		{"videoRenderer":{"videoId":"aaaaaaaaaaa","title":{"simpleText":"Too long"},"lengthText":{"simpleText":"8:01"}}},
		{"videoRenderer":{"videoId":"dQw4w9WgXcQ","title":{"simpleText":"Duplicate"},"lengthText":{"simpleText":"3:32"}}}
	]};</script></html>`)
	items, err := parseSearchPage(page)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("items=%d", len(items))
	}
	item := items[0]
	if item.ID != "dQw4w9WgXcQ" || item.Title != "Song & Mix" || item.Duration != 212 || item.Performer != "Artist" {
		t.Fatalf("unexpected item: %+v", item)
	}
	if item.SmallThumbnail != "small" || item.LargeThumbnail != "large" {
		t.Fatalf("unexpected thumbnails: %+v", item)
	}
}

func TestParseDurationText(t *testing.T) {
	t.Parallel()
	for input, want := range map[string]float64{"3:05": 185, "1:02:03": 3723, "LIVE": 0, "3:99": 0} {
		if got := parseDurationText(input); got != want {
			t.Fatalf("parseDurationText(%q)=%v, want %v", input, got, want)
		}
	}
}

func TestSnapshotCookiesCreatesWritablePrivateCopy(t *testing.T) {
	t.Parallel()
	directory := t.TempDir()
	original := filepath.Join(directory, "cookies.txt")
	if err := os.WriteFile(original, []byte("original-cookie"), 0o400); err != nil {
		t.Fatal(err)
	}
	service := New(config.Config{CookiesPath: original})
	snapshot, cleanup, err := service.snapshotCookies()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot == "" || snapshot == original {
		t.Fatalf("snapshot path = %q", snapshot)
	}
	if err := os.WriteFile(snapshot, []byte("updated-cookie"), 0o600); err != nil {
		t.Fatalf("snapshot is not writable: %v", err)
	}
	cleanup()
	if _, err := os.Stat(snapshot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary cookie snapshot still exists: %v", err)
	}
	contents, err := os.ReadFile(original)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "original-cookie" {
		t.Fatalf("canonical cookie was modified: %q", contents)
	}
}
