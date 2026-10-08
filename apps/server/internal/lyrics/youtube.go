package lyrics

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

var videoIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

type captionFormat struct {
	URL       string `json:"url"`
	Extension string `json:"ext"`
	Name      string `json:"name"`
}
type youtubeInfo struct {
	Title     string                     `json:"title"`
	Track     string                     `json:"track"`
	Artist    string                     `json:"artist"`
	Duration  float64                    `json:"duration"`
	Language  string                     `json:"language"`
	Subtitles map[string][]captionFormat `json:"subtitles"`
	Automatic map[string][]captionFormat `json:"automatic_captions"`
	Formats   []struct {
		Language string `json:"language"`
	} `json:"formats"`
}
type captionChoice struct {
	language  string
	automatic bool
}

func FetchYouTubeSubtitles(ctx context.Context, path, cookies, videoID string) (*model.TrackLyrics, error) {
	result, err := FetchYouTube(ctx, path, cookies, videoID)
	return result.Lyrics, err
}

// FetchYouTube extracts metadata once, then downloads only original-language
// captions. Automatic translations are never eligible as song lyrics.
func FetchYouTube(parent context.Context, path, cookies, videoID string) (model.YouTubeLyricsResult, error) {
	var result model.YouTubeLyricsResult
	if path == "" || !videoIDPattern.MatchString(videoID) {
		return result, fmt.Errorf("invalid YouTube lyric request")
	}
	ctx, cancel := context.WithTimeout(parent, 25*time.Second)
	defer cancel()
	temporary, err := os.MkdirTemp("", "beatsync-lyrics-*")
	if err != nil {
		return result, err
	}
	defer os.RemoveAll(temporary)
	cookieFile, err := snapshotCookies(cookies, temporary)
	if err != nil {
		return result, err
	}
	common := []string{"--ignore-config", "--no-warnings", "--no-progress", "--no-cache-dir", "--no-playlist", "--socket-timeout", "7", "--retries", "1"}
	if cookieFile != "" {
		common = append(common, "--cookies", cookieFile)
	}
	args := append(append([]string(nil), common...), "--skip-download", "--dump-single-json", "--extractor-args", "youtube:skip=translated_subs", "https://www.youtube.com/watch?v="+videoID)
	raw, err := runExtractor(ctx, path, args...)
	if err != nil {
		return result, err
	}
	var info youtubeInfo
	if err = json.Unmarshal(raw, &info); err != nil {
		return result, fmt.Errorf("invalid YouTube metadata")
	}
	expected := originalLanguage(info)
	result.Metadata = model.LyricsMetadata{Title: info.Title, Track: info.Track, Artist: info.Artist, Duration: info.Duration, Language: expected}
	choices := selectCaptions(info, expected)
	if len(choices) == 0 {
		return result, nil
	}
	infoPath := filepath.Join(temporary, "metadata.json")
	if err = os.WriteFile(infoPath, raw, 0600); err != nil {
		return result, err
	}
	var lastError error
	// One manual track then one original automatic track is enough; downloading
	// every translated language consumes the budget and causes rate limiting.
	for _, choice := range choices {
		leftovers, _ := filepath.Glob(filepath.Join(temporary, "caption.*"))
		for _, name := range leftovers {
			_ = os.Remove(name)
		}
		output := filepath.Join(temporary, "caption.%(ext)s")
		subArgs := append(append([]string(nil), common...), "--skip-download", "--load-info-json", infoPath, "--sub-format", "json3/vtt", "--sub-langs", regexp.QuoteMeta(choice.language), "-o", output)
		if choice.automatic {
			subArgs = append(subArgs, "--no-write-subs", "--write-auto-subs")
		} else {
			subArgs = append(subArgs, "--write-subs", "--no-write-auto-subs")
		}
		if _, err = runExtractor(ctx, path, subArgs...); err != nil {
			lastError = err
			continue
		}
		matches, _ := filepath.Glob(filepath.Join(temporary, "caption.*"))
		for _, name := range matches {
			if !strings.HasSuffix(name, ".json3") && !strings.HasSuffix(name, ".vtt") {
				continue
			}
			data, readErr := readLimitedFile(name, 1<<20)
			if readErr != nil {
				lastError = readErr
				continue
			}
			var synced, plain string
			var lines []ParsedLine
			if strings.HasSuffix(name, ".json3") {
				synced, plain, lines, err = ParseJSON3(data)
			} else {
				synced, plain, lines, err = ParseVTT(string(data))
			}
			_ = os.Remove(name)
			if err != nil {
				lastError = err
				continue
			}
			if !languageMatches(plain, expected) {
				continue
			}
			// Speech-only intros and markers are not sufficient lyrics for a song.
			if len(lines) < 2 || len([]rune(plain)) < 30 {
				continue
			}
			provider := "youtube-manual"
			if choice.automatic {
				provider = "youtube-auto"
			}
			kind := "line"
			for _, line := range lines {
				if len(line.Words) > 0 {
					kind = "word"
					break
				}
			}
			value := &model.TrackLyrics{Synced: synced, Provider: provider, Language: baseLanguage(choice.language), SyncType: kind, Lines: lines, ResolverVersion: model.LyricsResolverVersion, Automatic: true}
			if !model.ValidTrackLyrics(value) && len(value.Lines) > 0 {
				// Enhanced LRC retains original word times and gap cues even
				// when the duplicate structure would exceed the payload limit.
				value.Lines = nil
			}
			if !model.ValidTrackLyrics(value) {
				lastError = fmt.Errorf("YouTube lyrics exceed timing or size limits")
				continue
			}
			result.Lyrics = value
			return result, nil
		}
	}
	return result, lastError
}

func selectCaptions(info youtubeInfo, expected string) []captionChoice {
	expected = baseLanguage(expected)
	if expected == "" {
		return nil
	}
	var choices []captionChoice
	for _, automatic := range []bool{false, true} {
		tracks := info.Subtitles
		if automatic {
			tracks = info.Automatic
		}
		var codes []string
		for code, formats := range tracks {
			if baseLanguage(code) != expected || len(formats) == 0 {
				continue
			}
			translated := false
			for _, format := range formats {
				parsed, err := url.Parse(format.URL)
				if err != nil || parsed.Query().Get("tlang") != "" || strings.Contains(strings.ToLower(format.Name), " from ") {
					translated = true
				}
			}
			if translated {
				continue
			}
			// Auto tracks must explicitly identify the native language, or have lang
			// matching the requested original language and no translation parameter.
			if automatic && !strings.HasSuffix(code, "-orig") {
				native := false
				for _, format := range formats {
					parsed, _ := url.Parse(format.URL)
					if parsed != nil && baseLanguage(parsed.Query().Get("lang")) == expected {
						native = true
					}
				}
				if !native {
					continue
				}
			}
			codes = append(codes, code)
		}
		sort.Slice(codes, func(i, j int) bool {
			if strings.HasSuffix(codes[i], "-orig") != strings.HasSuffix(codes[j], "-orig") {
				return strings.HasSuffix(codes[i], "-orig")
			}
			if (codes[i] == expected) != (codes[j] == expected) {
				return codes[i] == expected
			}
			return codes[i] < codes[j]
		})
		if len(codes) > 0 {
			choices = append(choices, captionChoice{language: codes[0], automatic: automatic})
		}
	}
	return choices
}

func originalLanguage(info youtubeInfo) string {
	// A multilingual artist name in a title does not describe the song's language.
	native := ""
	ambiguous := false
	for code := range info.Automatic {
		if strings.HasSuffix(code, "-orig") {
			candidate := baseLanguage(code)
			if native != "" && native != candidate {
				ambiguous = true
			}
			native = candidate
		}
	}
	if native != "" && !ambiguous {
		return native
	}
	if language := baseLanguage(info.Language); language != "" {
		return language
	}
	for _, format := range info.Formats {
		if format.Language != "" {
			return baseLanguage(format.Language)
		}
	}
	if language := detectLanguage(info.Track); language != "" {
		return language
	}
	return detectLanguage(info.Title)
}

func snapshotCookies(source, directory string) (string, error) {
	if source == "" {
		return "", nil
	}
	data, err := readLimitedFile(source, 4<<20)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("cannot read YouTube cookies")
	}
	target := filepath.Join(directory, "cookies.txt")
	if err = os.WriteFile(target, data, 0600); err != nil {
		return "", err
	}
	return target, nil
}

type limitedBuffer struct {
	bytes.Buffer
	limit    int
	overflow bool
}

func (b *limitedBuffer) Write(data []byte) (int, error) {
	size := len(data)
	available := b.limit - b.Len()
	if available < len(data) {
		b.overflow = true
		data = data[:max(0, available)]
	}
	_, _ = b.Buffer.Write(data)
	return size, nil
}
func runExtractor(ctx context.Context, path string, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, path, args...)
	output := &limitedBuffer{limit: 4 << 20}
	stderr := &limitedBuffer{limit: 4096}
	command.Stdout, command.Stderr = output, stderr
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("YouTube lyric extraction failed: %w", err)
	}
	if output.overflow {
		return nil, fmt.Errorf("YouTube metadata exceeds size limit")
	}
	return output.Bytes(), nil
}
func readLimitedFile(path string, limit int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("file exceeds size limit")
	}
	return data, nil
}
