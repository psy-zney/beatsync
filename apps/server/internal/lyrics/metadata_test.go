package lyrics

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

func TestUploaderMustMatchCompleteVideoArtistCredits(t *testing.T) {
	cases := []struct{ title, channel, track, artist string }{
		{"The Weeknd, JENNIE & Lily Rose Depp - One Of The Girls (Official Audio)", "The Weeknd", "One Of The Girls", "The Weeknd"},
		{"The Weeknd - The Weeknd, JENNIE & Lily Rose Depp - One Of The Girls (Official Audio)", "The Weeknd", "One Of The Girls", "The Weeknd"},
		{"Lady Gaga, Bruno Mars - Die With A Smile (Official Music Video)", "Lady Gaga", "Die With A Smile", "Lady Gaga"},
		{"Sống Xa Anh Chẳng Dễ Dàng | Lyrics Video | Bảo Anh ft Mr Siro", "Bảo Anh", "Sống Xa Anh Chẳng Dễ Dàng", "Bảo Anh"},
		{"Earth, Wind & Fire - September (Official Audio)", "Earth, Wind & Fire", "September", "Earth, Wind & Fire"},
		{"Artist - Song (Official Audio)", "Artist - Topic", "Song", "Artist"},
		{"Artist - Song", "ArtistVEVO", "Song", "Artist"},
		{"The Weeknd, JENNIE & Lily Rose Depp - One Of The Girls", "Lyrics Channel", "", ""},
		{"The Weeknd - One Of The Girls", "The", "", ""},
		{"Artist - One - Two", "Artist", "", ""},
		{"Just a title", "Uploader", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.title+"/"+tc.channel, func(t *testing.T) {
			track, artist := inferCreditedTrack(tc.title, tc.channel)
			if track != tc.track || artist != tc.artist {
				t.Fatalf("got (%q, %q), want (%q, %q)", track, artist, tc.track, tc.artist)
			}
		})
	}
}

func TestEnglishCollaborationFallsBackWhenYouTubeHasNoCaptions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("q") != "The Weeknd - One Of The Girls" {
			t.Errorf("unusable query: %s", r.URL.RawQuery)
		}
		w.Write([]byte(`[{"trackName":"One Of The Girls","artistName":"Other Artist","duration":245,"syncedLyrics":"[00:01]I love you and you love me"},{"trackName":"One Of The Girls","artistName":"The Weeknd","duration":180,"syncedLyrics":"[00:01]Wrong version"},{"trackName":"One Of The Girls","artistName":"The Weeknd","duration":245,"syncedLyrics":"[00:01]I love you and you love me"}]`))
	}))
	defer server.Close()
	title := "The Weeknd - The Weeknd, JENNIE & Lily Rose Depp - One Of The Girls (Official Audio)"
	track, artist := inferCreditedTrack(title, "The Weeknd")
	service := NewService("", "")
	service.lrclibBaseURL = server.URL
	service.SetYouTubeFetcher(func(context.Context, string) (model.YouTubeLyricsResult, error) {
		return model.YouTubeLyricsResult{Metadata: model.LyricsMetadata{Title: title, Track: track, Artist: artist, Duration: 245, Language: "en"}}, nil
	})
	value, err := service.GetOrFetch(t.Context(), "track", "f1r0XZLNlGQ", title, 0)
	if err != nil || value == nil || value.Provider != "lrclib" || value.Language != "en" || value.SyncType != "line" {
		t.Fatalf("fallback=%+v, error=%v", value, err)
	}
}
