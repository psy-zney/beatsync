package youtube

import "testing"

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
