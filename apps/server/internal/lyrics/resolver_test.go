package lyrics

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

func TestStrictMatchingAndOriginalLanguage(t *testing.T) {
	if BuildSearchQuery("BTS (방탄소년단) 'Dynamite' Official MV") != "BTS (방탄소년단) 'Dynamite'" {
		t.Fatal("bare video decoration was retained")
	}
	viet := LRCLIBRecord{ID: 1, TrackName: "Chúng Ta Của Hiện Tại", ArtistName: "Sơn Tùng M-TP", Duration: 300, PlainLyrics: "Tình yêu của chúng ta trong hiện tại"}
	wrong := LRCLIBRecord{ID: 2, TrackName: "Other Song", ArtistName: "Other Artist", SyncedLyrics: "[00:01]I love you and you love me"}
	cases := []struct {
		query    string
		duration float64
		records  []LRCLIBRecord
		id       int
	}{
		{"Sơn Tùng M-TP - Chúng Ta Của Hiện Tại", 0, []LRCLIBRecord{wrong, viet}, 1},
		{"Chúng Ta Của Hiện Tại", 300, []LRCLIBRecord{wrong, viet}, 1},
		{"Chúng Ta Của Hiện Tại", 0, []LRCLIBRecord{viet}, 0},
		{"Different song", 0, []LRCLIBRecord{wrong}, 0},
		{"Sơn Tùng M-TP - Chúng Ta Của Hiện Tại (Live)", 300, []LRCLIBRecord{viet}, 0},
		{"Sơn Tùng M-TP - Chúng Ta Của Hiện Tại", 320, []LRCLIBRecord{viet}, 0},
		{"Son Tung M-TP - Chung Ta Cua Hien Tai", 300, []LRCLIBRecord{viet}, 1},
	}
	for _, tc := range cases {
		best := findBestMatch(tc.records, tc.query, tc.duration)
		if tc.id == 0 {
			if best != nil {
				t.Errorf("%s selected wrong result: %+v", tc.query, best)
			}
		} else if best == nil || best.ID != tc.id {
			t.Errorf("%s: got %+v", tc.query, best)
		}
	}
	translated := viet
	translated.PlainLyrics = "I love you and you love me"
	translated.SyncedLyrics = "[00:01]I love you and you love me"
	if got := findBestMatch([]LRCLIBRecord{translated}, "Sơn Tùng M-TP - Chúng Ta Của Hiện Tại", 300); got != nil {
		t.Fatal("Vietnamese song accepted English translation")
	}
	english := LRCLIBRecord{TrackName: "Song", ArtistName: "Artist", SyncedLyrics: "[00:01]I love you and you love me"}
	if findBestMatch([]LRCLIBRecord{english}, "Artist - Song", 0) == nil {
		t.Fatal("English originals must remain supported")
	}
}

func TestOriginalCaptionSelection(t *testing.T) {
	if !languageMatches("BTS 방탄소년단\nI love you and you love me. I love you and you love me.", "en") {
		t.Fatal("short artist credits overrode lyric language")
	}
	if got := originalLanguage(youtubeInfo{Title: "BTS (방탄소년단) 'Dynamite' Official MV", Language: "en", Automatic: map[string][]captionFormat{"en-orig": {{URL: "https://youtube.com/api/timedtext?lang=en"}}}}); got != "en" {
		t.Fatalf("artist name overrode original audio language: %s", got)
	}
	info := youtubeInfo{Subtitles: map[string][]captionFormat{
		"en": {{URL: "https://youtube.com/api/timedtext?lang=en"}},
		"vi": {{URL: "https://youtube.com/api/timedtext?lang=vi"}},
	}, Automatic: map[string][]captionFormat{
		"vi-en":   {{URL: "https://youtube.com/api/timedtext?lang=en&tlang=vi", Name: "Vietnamese from English"}},
		"vi-orig": {{URL: "https://youtube.com/api/timedtext?lang=vi"}},
		"en-orig": {{URL: "https://youtube.com/api/timedtext?lang=en"}},
	}}
	choices := selectCaptions(info, "vi")
	if len(choices) != 2 || choices[0].language != "vi" || choices[0].automatic || choices[1].language != "vi-orig" {
		t.Fatalf("choices=%+v", choices)
	}
	info.Subtitles = nil
	delete(info.Automatic, "vi-orig")
	if len(selectCaptions(info, "vi")) != 0 {
		t.Fatal("translated captions must be excluded")
	}
	if choices := selectCaptions(info, "en"); len(choices) != 1 || choices[0].language != "en-orig" {
		t.Fatal("English native captions rejected")
	}
}

func TestReportedVietnameseTitlesAndCollaboratorCredits(t *testing.T) {
	query := BuildSearchQuery("Hngle - Tìm em ft. Bảo Anh | Official Music Video")
	if query != "Hngle - Tìm em" {
		t.Fatalf("query=%q", query)
	}
	if got := BuildSearchQuery("Sống Xa Anh Chẳng Dễ Dàng | Lyrics Video | Bảo Anh ft Mr Siro"); got != "Sống Xa Anh Chẳng Dễ Dàng - Bảo Anh" {
		t.Fatalf("artist credits dropped: %q", got)
	}
	records := []LRCLIBRecord{
		{ID: 1, TrackName: "Tìm Em", ArtistName: "Hngle", Duration: 274, PlainLyrics: "Ngồi ngẩn ngơ, anh hát vu vơ những bản tình ca năm ấy"},
		{ID: 2, TrackName: "Tìm Em", ArtistName: "Hngle & Bảo Anh", Duration: 274, SyncedLyrics: "[00:10.10]Ngồi ngẩn ngơ, anh hát vu vơ những bản tình ca năm ấy"},
		{ID: 3, TrackName: "Tìm Em (feat. Bảo Anh)", ArtistName: "Someone else", Duration: 274, SyncedLyrics: "[00:10]Một bài khác"},
	}
	if got := findMetadataMatch(records, query, model.LyricsMetadata{Title: "Hngle - Tìm em ft. Bảo Anh | Official Music Video", Duration: 272, Language: "vi"}); got == nil || got.ID != 2 {
		t.Fatalf("collaborator lookup=%+v", got)
	}
	if got := findMetadataMatch(records, "Hngle - Tìm Em", model.LyricsMetadata{Track: "Tìm Em (cùng với Bảo Anh)", Artist: "Hngle, Bảo Anh", Duration: 272, Language: "vi"}); got == nil || got.ID != 2 {
		t.Fatalf("structured credits=%+v", got)
	}
	// This real catalog entry had the wrong song's text and a 15s duration mismatch.
	wrong := LRCLIBRecord{TrackName: "Sống Xa Anh Chẳng Dễ Dàng", ArtistName: "Bao Anh", Duration: 256, PlainLyrics: "Nếu như là năm ngoái giờ này"}
	title := "Sống Xa Anh Chẳng Dễ Dàng | Lyrics Video | Bảo Anh ft Mr Siro"
	if got := findMetadataMatch([]LRCLIBRecord{wrong}, BuildSearchQuery(title), model.LyricsMetadata{Title: title, Duration: 271, Language: "vi"}); got != nil {
		t.Fatal("wrong catalog entry accepted")
	}
	if primaryArtist("") != "" || primaryArtist("&,;") != "" {
		t.Fatal("empty artist not handled")
	}
	band := LRCLIBRecord{ID: 4, TrackName: "September", ArtistName: "Earth, Wind & Fire", Duration: 200, PlainLyrics: "Do you remember when we were together"}
	cover := band
	cover.ID = 5
	cover.ArtistName = "Earth"
	if got := findMetadataMatch([]LRCLIBRecord{cover, band}, "Earth, Wind & Fire - September", model.LyricsMetadata{Title: "Earth, Wind & Fire - September", Track: "September", Artist: "Earth, Wind & Fire", Duration: 200}); got == nil || got.ID != 4 {
		t.Fatal("band's comma/ampersand name was truncated")
	}
}

func TestCanceledLookupDoesNotPoisonCache(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Write([]byte(`[{"trackName":"Song","artistName":"Artist","duration":100,"syncedLyrics":"[00:01]Hello"}]`))
	}))
	defer server.Close()
	service := NewService("", "")
	service.lrclibBaseURL = server.URL
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := service.GetOrFetch(ctx, "track", "", "Artist - Song", 100); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation=%v", err)
	}
	value, err := service.GetOrFetch(t.Context(), "track", "", "Artist - Song", 100)
	if err != nil || value == nil || calls.Load() != 1 {
		t.Fatalf("retry=%+v %v calls=%d", value, err, calls.Load())
	}
}

func TestCacheByVideoAndPersistence(t *testing.T) {
	directory := t.TempDir()
	service := NewService("", "", WithCacheDirectory(directory))
	var count atomic.Int32
	service.SetYouTubeFetcher(func(context.Context, string) (model.YouTubeLyricsResult, error) {
		count.Add(1)
		return model.YouTubeLyricsResult{Lyrics: &model.TrackLyrics{Synced: "[00:01]Xin chào Việt Nam", Provider: "youtube-manual", Language: "vi"}}, nil
	})
	for _, key := range []string{"/youtube/proxy?videoId=abcdefghijk", "https://r2.test/youtube-cache/abcdefghijk.webm"} {
		if value, err := service.GetOrFetch(t.Context(), key, "abcdefghijk", "", 0); err != nil || value == nil {
			t.Fatalf("lookup=%+v %v", value, err)
		}
	}
	if count.Load() != 1 {
		t.Fatal("same video fetched more than once")
	}
	restarted := NewService("", "", WithCacheDirectory(directory))
	restarted.SetYouTubeFetcher(func(context.Context, string) (model.YouTubeLyricsResult, error) {
		t.Error("disk cache was not used")
		return model.YouTubeLyricsResult{}, errors.New("offline")
	})
	if value, err := restarted.GetOrFetch(t.Context(), "new URL", "abcdefghijk", "", 0); value == nil || err != nil {
		t.Fatal("persistent cache failed")
	}
	for i := 0; i < maxCacheEntries+10; i++ {
		service.store(string(rune(i)), nil, time.Minute)
	}
	if len(service.cache) > maxCacheEntries {
		t.Fatal("cache grew without a bound")
	}
}

func TestProviderConcurrencyAndSharedErrors(t *testing.T) {
	service := NewService("", "", WithConcurrency(1))
	var active, peak atomic.Int32
	service.SetYouTubeFetcher(func(ctx context.Context, id string) (model.YouTubeLyricsResult, error) {
		current := active.Add(1)
		for old := peak.Load(); current > old && !peak.CompareAndSwap(old, current); old = peak.Load() {
		}
		defer active.Add(-1)
		select {
		case <-time.After(20 * time.Millisecond):
		case <-ctx.Done():
			return model.YouTubeLyricsResult{}, ctx.Err()
		}
		return model.YouTubeLyricsResult{}, errors.New("temporary failure")
	})
	var group sync.WaitGroup
	for _, id := range []string{"abcdefghijk", "bcdefghijkl", "cdefghijklm"} {
		group.Add(1)
		go func(id string) {
			defer group.Done()
			if _, err := service.GetOrFetch(t.Context(), id, id, "", 0); err == nil {
				t.Error("provider error swallowed")
			}
		}(id)
	}
	group.Wait()
	if peak.Load() != 1 {
		t.Fatalf("peak=%d", peak.Load())
	}
}

func TestMetadataDurationAndFallbackAfterYouTubeFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`[{"trackName":"Song","artistName":"Artist","duration":200,"syncedLyrics":"[00:01]Wrong version"},{"trackName":"Song","artistName":"Artist","duration":100,"syncedLyrics":"[00:01]Right version"}]`))
	}))
	defer server.Close()
	service := NewService("", "")
	service.lrclibBaseURL = server.URL
	service.SetYouTubeFetcher(func(context.Context, string) (model.YouTubeLyricsResult, error) {
		return model.YouTubeLyricsResult{Metadata: model.LyricsMetadata{Title: "Artist - Song", Track: "Song", Artist: "Artist", Duration: 100}}, context.DeadlineExceeded
	})
	value, err := service.GetOrFetch(t.Context(), "track", "abcdefghijk", "Old title", 0)
	if err != nil || value == nil || !strings.Contains(value.Synced, "Right version") {
		t.Fatalf("fallback=%+v error=%v", value, err)
	}
}

func TestCookieSnapshotDoesNotModifyCanonical(t *testing.T) {
	directory := t.TempDir()
	canonical := filepath.Join(directory, "canonical.txt")
	original := []byte("# Netscape HTTP Cookie File\n")
	if err := os.WriteFile(canonical, original, 0400); err != nil {
		t.Fatal(err)
	}
	temporary := t.TempDir()
	snapshot, err := snapshotCookies(canonical, temporary)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(snapshot, []byte("modified"), 0600); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(canonical)
	if err != nil || string(actual) != string(original) {
		t.Fatal("canonical cookie changed")
	}
}

func TestMalformedCaptionsAndWordTiming(t *testing.T) {
	for _, raw := range []string{"WEBVTT\n\n --> 00:00:02.000\nHello", "WEBVTT\n\n00:00:04.000 --> 00:00:02.000\nHello", "WEBVTT\n\n00:99:01.000 --> 00:99:02.000\nHello"} {
		if _, _, _, err := ParseVTT(raw); err == nil {
			t.Fatal("malformed VTT accepted")
		}
	}
	raw := "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nYêu em\n\n00:00:04.000 --> 00:00:05.000\nYêu em\n"
	synced, _, lines, err := ParseVTT(raw)
	if err != nil || len(lines) != 2 || !strings.Contains(synced, "[00:02.00]\n") {
		t.Fatalf("repeated lyrics/gaps=%+v %q %v", lines, synced, err)
	}
	_, _, lines, err = ParseVTT("WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<00:00:01.000>Xin <00:00:02.000>chào\n")
	if err != nil || len(lines[0].Words) != 2 || lines[0].Words[1].StartTime != 2 {
		t.Fatal("word timing discarded")
	}
	_, _, lines, err = ParseJSON3([]byte(`{"events":[{"tStartMs":1000,"dDurationMs":3000,"segs":[{"utf8":"Xin ","tOffsetMs":0},{"utf8":"chào Việt Nam","tOffsetMs":1000}]}]}`))
	if err != nil || lines[0].Words[1].StartTime != 2 || lines[0].EndTime != 4 {
		t.Fatal("JSON3 timing wrong")
	}
}
