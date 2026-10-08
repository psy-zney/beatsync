package lyrics

import (
	"strings"
	"testing"
)

func TestParseVTTNormal(t *testing.T) {
	raw := `WEBVTT
Kind: captions
Language: vi

00:00:10.500 --> 00:00:13.200
Xin chào Việt Nam

00:00:14.000 --> 00:00:17.500
<i>Đất nước hình tia chớp</i>
`
	synced, plain, lines, err := ParseVTT(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d", len(lines))
	}

	if lines[0].Text != "Xin chào Việt Nam" || lines[0].StartTime != 10.5 {
		t.Errorf("line 0 mismatch: %#v", lines[0])
	}

	if lines[1].Text != "Đất nước hình tia chớp" || lines[1].StartTime != 14.0 {
		t.Errorf("line 1 mismatch: %#v", lines[1])
	}

	if !strings.Contains(synced, "[00:10.50]Xin chào Việt Nam") {
		t.Errorf("synced LRC mismatch: %s", synced)
	}

	if !strings.Contains(synced, "[00:14.00]Đất nước hình tia chớp") {
		t.Errorf("synced LRC mismatch: %s", synced)
	}

	expectedPlain := "Xin chào Việt Nam\nĐất nước hình tia chớp"
	if plain != expectedPlain {
		t.Errorf("plain text mismatch: got %q, want %q", plain, expectedPlain)
	}
}

func TestParseVTTRollingCaptions(t *testing.T) {
	// YouTube auto captions often duplicate previous line in the next cue
	raw := `WEBVTT
Language: vi

00:00:05.000 --> 00:00:07.000
Câu hát đầu tiên

00:00:07.000 --> 00:00:09.000
Câu hát đầu tiên
Câu hát thứ hai

00:00:09.000 --> 00:00:11.000
Câu hát thứ hai
Câu hát thứ ba
`
	_, plain, lines, err := ParseVTT(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(lines) != 3 {
		t.Fatalf("expected 3 deduplicated lines, got %d: %#v", len(lines), lines)
	}

	if lines[0].Text != "Câu hát đầu tiên" || lines[1].Text != "Câu hát thứ hai" || lines[2].Text != "Câu hát thứ ba" {
		t.Errorf("unexpected lines: %#v", lines)
	}

	expectedPlain := "Câu hát đầu tiên\nCâu hát thứ hai\nCâu hát thứ ba"
	if plain != expectedPlain {
		t.Errorf("plain text mismatch: got %q, want %q", plain, expectedPlain)
	}
}

func TestParseVTTWithHTMLEntitiesAndMusicMarkers(t *testing.T) {
	raw := `WEBVTT

00:00:01.000 --> 00:00:03.000
[Âm nhạc]

00:00:04.200 --> 00:00:07.100
Rock &amp; Roll &lt;Yeah&gt;
`
	_, plain, lines, err := ParseVTT(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(lines) != 1 {
		t.Fatalf("expected 1 line (music marker skipped), got %d: %#v", len(lines), lines)
	}

	if lines[0].Text != "Rock & Roll <Yeah>" {
		t.Errorf("expected unescaped HTML entities, got %q", lines[0].Text)
	}

	if plain != "Rock & Roll <Yeah>" {
		t.Errorf("plain mismatch: %q", plain)
	}
}
