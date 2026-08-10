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
