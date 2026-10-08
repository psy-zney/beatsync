package lyrics

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
	"golang.org/x/text/unicode/norm"
)

func TestASROnlyVideoDoesNotSelectAutomaticCaptionTracks(t *testing.T) {
	info := youtubeInfo{Title: "Rời Bỏ - Hòa Minzy", Language: "vi", Automatic: map[string][]captionFormat{
		"vi-orig": {{URL: "https://youtube.com/api/timedtext?lang=vi", Name: "Vietnamese (Original)"}},
	}}
	if choices := selectCaptions(info, originalLanguage(info)); len(choices) != 0 {
		t.Fatalf("ASR choices=%+v", choices)
	}
	info.Subtitles = map[string][]captionFormat{"vi": {{URL: "https://youtube.com/api/timedtext?lang=vi"}}}
	if choices := selectCaptions(info, "vi"); len(choices) != 1 || choices[0].language != "vi" {
		t.Fatal("original author captions were lost")
	}
}

func TestCachedASRIsRejectedEvenWithCurrentResolverVersion(t *testing.T) {
	for _, location := range []string{"memory", "disk", "seed"} {
		t.Run(location, func(t *testing.T) {
			service := NewService("", "", WithCacheDirectory(t.TempDir()))
			key := canonicalKey("ALzPt-7pEOc", "")
			old := &model.TrackLyrics{Provider: "youtube-auto", Language: "vi", Synced: "[00:01]Lời nhận dạng sai", ResolverVersion: model.LyricsResolverVersion}
			switch location {
			case "memory":
				service.store(key, old, time.Hour)
			case "disk":
				data, err := json.Marshal(cacheEntry{Lyrics: old, Version: cacheVersion, Expires: time.Now().Add(time.Hour)})
				if err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(service.cachePath(key), data, 0600); err != nil {
					t.Fatal(err)
				}
			case "seed":
				service.StoreManually("ALzPt-7pEOc", old)
			}
			calls := 0
			service.SetYouTubeFetcher(func(context.Context, string) (model.YouTubeLyricsResult, error) {
				calls++
				return model.YouTubeLyricsResult{Lyrics: &model.TrackLyrics{Provider: "youtube-manual", Language: "vi", Synced: "[00:01]Lời do tác giả cung cấp"}}, nil
			})
			value, err := service.GetOrFetch(t.Context(), "ALzPt-7pEOc", "ALzPt-7pEOc", "", 0)
			if err != nil || calls != 1 || value == nil || value.Provider != "youtube-manual" {
				t.Fatalf("ASR cache bypass failed: calls=%d lyrics=%+v error=%v", calls, value, err)
			}
		})
	}
}

func TestDecomposedYouTubeTitleResolvesComposedCatalogLyrics(t *testing.T) {
	wanted := "Hòa Minzy - Rời Bỏ"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if query := r.URL.Query().Get("q"); query != wanted {
			t.Errorf("catalog query=%q, want composed %q", query, wanted)
			w.Write([]byte(`[]`))
			return
		}
		w.Write([]byte(`[{"trackName":"Rời Bỏ","artistName":"Hòa Minzy","duration":278,"syncedLyrics":"[00:01]Lời bài hát được đối chiếu đúng"}]`))
	}))
	defer server.Close()
	service := NewService("", "")
	service.lrclibBaseURL = server.URL
	service.SetYouTubeFetcher(func(context.Context, string) (model.YouTubeLyricsResult, error) {
		return model.YouTubeLyricsResult{Metadata: model.LyricsMetadata{
			Title: norm.NFD.String("Rời Bỏ - Hòa Minzy | Official Lyrics Video"),
			Track: norm.NFD.String("Rời Bỏ"), Artist: norm.NFD.String("Hòa Minzy"), Duration: 277,
		}}, nil
	})
	value, err := service.GetOrFetch(t.Context(), "ALzPt-7pEOc", "ALzPt-7pEOc", "", 0)
	if err != nil || value == nil || value.Provider != "lrclib" || value.Language != "vi" {
		t.Fatalf("decomposed title failed: lyrics=%+v error=%v", value, err)
	}
	if language := detectLanguage(norm.NFD.String("Rời Bỏ")); language != "vi" {
		t.Fatalf("decomposed Vietnamese language=%q", language)
	}
}

func TestOldWorkerASRCannotSuppressCatalogLookupOrPoisonCache(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusServiceUnavailable} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				w.WriteHeader(status)
				if status == http.StatusOK {
					w.Write([]byte(`[{"trackName":"Rời Bỏ","artistName":"Hòa Minzy","duration":277,"syncedLyrics":"[00:01]Lời bài hát được đối chiếu đúng\n[00:05]Một câu lời khác phù hợp"}]`))
				}
			}))
			defer server.Close()
			service := NewService("", "")
			service.lrclibBaseURL = server.URL
			service.SetYouTubeFetcher(func(context.Context, string) (model.YouTubeLyricsResult, error) {
				return model.YouTubeLyricsResult{
					Lyrics:   &model.TrackLyrics{Provider: "youtube-auto", Language: "vi", Synced: "[00:01]nghỉ em có quen vui à\n[00:03]bộ phim về à"},
					Metadata: model.LyricsMetadata{Title: "Rời Bỏ - Hòa Minzy", Track: "Rời Bỏ", Artist: "Hòa Minzy", Duration: 277, Language: "vi"},
				}, nil
			})
			value, err := service.GetOrFetch(t.Context(), "track", "ALzPt-7pEOc", "Rời Bỏ - Hòa Minzy", 0)
			if requests != 1 {
				t.Fatal("ASR prevented the catalog lookup")
			}
			if status == http.StatusOK {
				if err != nil || value == nil || value.Provider != "lrclib" {
					t.Fatalf("replacement=%+v error=%v", value, err)
				}
			} else {
				if err == nil || value != nil || len(service.cache) != 0 {
					t.Fatalf("unreliable ASR or an outage was cached: %+v %v", value, err)
				}
				if _, err := service.GetOrFetch(t.Context(), "track", "ALzPt-7pEOc", "Rời Bỏ - Hòa Minzy", 0); err == nil || errors.Is(err, context.Canceled) || requests != 2 {
					t.Fatal("provider outage did not remain retryable")
				}
			}
		})
	}
}
