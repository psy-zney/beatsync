package lyrics

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

var (
	extRegex               = regexp.MustCompile(`(?i)\.(mp3|m4a|wav|flac|ogg|aac|webm)$`)
	decoratorRegex         = regexp.MustCompile(`(?i)[\[(](?:official\s*)?(?:music\s*video|audio|video|lyrics?|lyric\s*video|visuali[sz]er|mv|hd|4k)[^\])]*[\])]`)
	separatorRegex         = regexp.MustCompile(`(?i)\s*[|–—]\s*(?:official\s*)?(?:music\s*video|audio|video|lyrics?).*$`)
	trailingDecoratorRegex = regexp.MustCompile(`(?i)\s+(?:official\s+)?(?:music\s+video|lyric\s+video|audio|video|mv|visuali[sz]er)\s*$`)
	quotedTrackRegex       = regexp.MustCompile(`^(.+?)\s+['"‘“](.+?)['"’”](.*)$`)
	artistAliasRegex       = regexp.MustCompile(`\([^)]*[\x{3040}-\x{9fff}\x{ac00}-\x{d7af}][^)]*\)`)
	lrcTimeRegex           = regexp.MustCompile(`(?m)^\[(\d{1,3}):([0-5]\d)(?:[.:]\d{1,3})?\].*\S`)
	featuredArtistRegex    = regexp.MustCompile(`(?i)\s+(?:[\[(]\s*)?(?:ft\.?|feat\.?|featuring|cùng với)\s+.*$`)
	pipeDecoratorRegex     = regexp.MustCompile(`(?i)^(?:official\s+)?(?:lyrics?|lyric\s+video|music\s+video|video|audio|mv|visuali[sz]er)\b`)
)

type LRCLIBRecord struct {
	ID           int     `json:"id"`
	TrackName    string  `json:"trackName"`
	ArtistName   string  `json:"artistName"`
	AlbumName    string  `json:"albumName"`
	Duration     float64 `json:"duration"`
	Instrumental bool    `json:"instrumental"`
	PlainLyrics  string  `json:"plainLyrics"`
	SyncedLyrics string  `json:"syncedLyrics"`
}

func BuildSearchQuery(title string) string {
	// Keep artist credits after a decorative pipe segment instead of dropping
	// everything after "Lyrics Video". Collaborator credits vary across catalogs.
	var parts []string
	for _, part := range strings.Split(title, "|") {
		part = strings.TrimSpace(part)
		if pipeDecoratorRegex.MatchString(part) {
			continue
		}
		parts = append(parts, part)
	}
	title = strings.Join(parts, " - ")
	query := strings.Join(strings.Fields(trailingDecoratorRegex.ReplaceAllString(separatorRegex.ReplaceAllString(decoratorRegex.ReplaceAllString(extRegex.ReplaceAllString(title, ""), ""), ""), "")), " ")
	parts = strings.Split(query, " - ")
	for i, part := range parts {
		parts[i] = stripFeaturedArtist(part)
	}
	query = strings.Join(parts, " - ")
	runes := []rune(query)
	if len(runes) > 200 {
		query = string(runes[:200])
	}
	return query
}

func stripFeaturedArtist(value string) string {
	return strings.TrimSpace(featuredArtistRegex.ReplaceAllString(value, ""))
}

func primaryArtist(value string) string {
	value = stripFeaturedArtist(value)
	parts := strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == '&' || r == ';' })
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(parts[0])
}

const DefaultLRCLIBBase = "https://lrclib.net"

func SearchLRCLIB(ctx context.Context, client *http.Client, baseURL, title string, duration float64) (*model.TrackLyrics, error) {
	return searchLRCLIB(ctx, client, baseURL, model.LyricsMetadata{Title: title, Duration: duration, Language: detectLanguage(title)})
}

func searchLRCLIB(ctx context.Context, client *http.Client, baseURL string, metadata model.LyricsMetadata) (*model.TrackLyrics, error) {
	if metadata.Track == "" && metadata.Artist == "" {
		if parts := quotedTrackRegex.FindStringSubmatch(BuildSearchQuery(metadata.Title)); parts != nil {
			metadata.Artist = strings.TrimSpace(artistAliasRegex.ReplaceAllString(parts[1], ""))
			metadata.Track = strings.TrimSpace(parts[2] + " " + parts[3])
		}
	}
	query := BuildSearchQuery(metadata.Title)
	if metadata.Track != "" && metadata.Artist != "" {
		query = stripFeaturedArtist(metadata.Artist) + " - " + stripFeaturedArtist(metadata.Track)
	}
	if query == "" {
		return nil, nil
	}
	if baseURL == "" {
		baseURL = DefaultLRCLIBBase
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(baseURL, "/")+"/api/search?q="+url.QueryEscape(query), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "BeatSync/1.0 (https://github.com/psy-zney/beatsync)")
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("lyrics search: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lyrics search HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return nil, fmt.Errorf("lyrics search response exceeds limit or is incomplete")
	}
	var records []LRCLIBRecord
	if err = json.Unmarshal(data, &records); err != nil {
		return nil, fmt.Errorf("invalid lyrics search response")
	}
	best := findMetadataMatch(records, query, metadata)
	if best == nil {
		return nil, nil
	}
	synced, plain := strings.TrimSpace(best.SyncedLyrics), strings.TrimSpace(best.PlainLyrics)
	if !lrcTimeRegex.MatchString(synced) {
		synced = ""
	}
	kind := "line"
	if synced == "" {
		kind = "none"
	} else {
		plain = ""
	}
	value := &model.TrackLyrics{Synced: synced, Plain: plain, Provider: "lrclib", Language: detectLanguage(best.PlainLyrics + "\n" + best.SyncedLyrics), SyncType: kind}
	if !model.ValidTrackLyrics(value) || !model.HasTrackLyrics(value) {
		return nil, fmt.Errorf("lyrics provider returned unusable data")
	}
	return value, nil
}

func findBestMatch(records []LRCLIBRecord, query string, duration float64) *LRCLIBRecord {
	return findMetadataMatch(records, query, model.LyricsMetadata{Title: query, Duration: duration, Language: detectLanguage(query)})
}

func findMetadataMatch(records []LRCLIBRecord, query string, metadata model.LyricsMetadata) *LRCLIBRecord {
	normalized := normalizeSearchString(BuildSearchQuery(query))
	// Only treat comma/ampersand names as collaborators when the source explicitly
	// says feat/ft. Otherwise they can be part of a band's actual name.
	featured := featuredArtistRegex.MatchString(metadata.Title) || featuredArtistRegex.MatchString(metadata.Track) || featuredArtistRegex.MatchString(metadata.Artist)
	artistKey := func(value string) string {
		if featured {
			value = primaryArtist(value)
		}
		return normalizeSearchString(stripFeaturedArtist(value))
	}
	expected := metadata.Language
	if expected == "" {
		expected = detectLanguage(metadata.Track + " " + metadata.Title)
	}
	var candidates []*LRCLIBRecord
	for i := range records {
		record := &records[i]
		if record.Instrumental || strings.TrimSpace(record.SyncedLyrics+record.PlainLyrics) == "" || !languageMatches(record.PlainLyrics+"\n"+record.SyncedLyrics, expected) {
			continue
		}
		track, artist := normalizeSearchString(stripFeaturedArtist(record.TrackName)), artistKey(record.ArtistName)
		if track == "" || artist == "" {
			continue
		}
		matches := normalized == artist+" "+track || normalized == track+" "+artist
		if metadata.Track != "" && metadata.Artist != "" {
			matches = track == normalizeSearchString(stripFeaturedArtist(metadata.Track)) && artist == artistKey(metadata.Artist)
		}
		// Title-only matching requires a known duration and a unique artist below.
		if normalized == track && metadata.Duration > 0 {
			matches = true
		}
		if !matches || (metadata.Duration > 0 && math.Abs(record.Duration-metadata.Duration) > 4) {
			continue
		}
		versionMismatch := false
		for _, version := range []string{"live", "remix", "acoustic", "cover"} {
			if strings.Contains(" "+normalizeSearchString(metadata.Title)+" ", " "+version+" ") && !strings.Contains(" "+normalizeSearchString(record.TrackName+" "+record.ArtistName+" "+record.AlbumName)+" ", " "+version+" ") {
				versionMismatch = true
			}
		}
		if versionMismatch {
			continue
		}
		if len(record.SyncedLyrics)+len(record.PlainLyrics) > model.MaxLyricsBytes*2 {
			continue
		}
		candidates = append(candidates, record)
	}
	if len(candidates) == 0 {
		return nil
	}
	identity := artistKey(candidates[0].ArtistName) + " " + normalizeSearchString(stripFeaturedArtist(candidates[0].TrackName))
	for _, record := range candidates[1:] {
		if artistKey(record.ArtistName)+" "+normalizeSearchString(stripFeaturedArtist(record.TrackName)) != identity {
			return nil
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		validI, validJ := lrcTimeRegex.MatchString(candidates[i].SyncedLyrics), lrcTimeRegex.MatchString(candidates[j].SyncedLyrics)
		if validI != validJ {
			return validI
		}
		if metadata.Duration > 0 {
			return math.Abs(candidates[i].Duration-metadata.Duration) < math.Abs(candidates[j].Duration-metadata.Duration)
		}
		return false
	})
	return candidates[0]
}
