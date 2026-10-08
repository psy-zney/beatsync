package model

import (
	"encoding/json"
	"math"
	"strings"
	"unicode/utf8"
)

const MaxLyricsBytes = 40_000
const LyricsResolverVersion = 5

func LegacyAutomaticLyrics(value *TrackLyrics) bool {
	if value != nil && value.ResolverVersion > 0 && !value.Automatic {
		return false
	}
	return value != nil && (value.Automatic || value.Provider == "youtube-manual" || value.Provider == "youtube-auto" || (value.Provider == "lrclib" && value.ResolverVersion == 0)) && value.ResolverVersion != LyricsResolverVersion
}

func ValidTrackLyrics(value *TrackLyrics) bool {
	if value == nil {
		return true
	}
	if len(value.Synced)+len(value.Plain) > MaxLyricsBytes || !utf8.ValidString(value.Synced+value.Plain) || !finite(value.Offset) || math.Abs(value.Offset) > 30 || len(value.Language) > 16 {
		return false
	}
	switch value.Provider {
	case "lrclib", "import", "youtube-manual", "youtube-auto", "user", "custom":
	default:
		return false
	}
	switch value.SyncType {
	case "", "none", "line", "word":
	default:
		return false
	}
	if len(value.Lines) > 1500 || value.ResolverVersion < 0 || value.ResolverVersion > 1000 {
		return false
	}
	previous := -1.0
	for _, line := range value.Lines {
		if !validTimes(line.StartTime, line.EndTime) || line.StartTime < previous || !utf8.ValidString(line.Text) || len(line.Words) > 200 {
			return false
		}
		previous = line.StartTime
		wordStart := line.StartTime
		for _, word := range line.Words {
			if !validTimes(word.StartTime, word.EndTime) || word.StartTime < wordStart || word.StartTime < line.StartTime || word.EndTime > line.EndTime+0.001 || !utf8.ValidString(word.Text) {
				return false
			}
			wordStart = word.StartTime
		}
	}
	if len(value.Lines) > 0 {
		data, err := json.Marshal(value)
		if err != nil || len(data) > MaxLyricsBytes {
			return false
		}
	}
	return true
}

func HasTrackLyrics(value *TrackLyrics) bool {
	if value == nil {
		return false
	}
	if strings.TrimSpace(value.Synced+value.Plain) != "" {
		return true
	}
	for _, line := range value.Lines {
		if strings.TrimSpace(line.Text) != "" {
			return true
		}
	}
	return false
}

func CloneTrackLyrics(value *TrackLyrics) *TrackLyrics {
	if value == nil {
		return nil
	}
	copy := *value
	copy.Lines = append([]LyricLine(nil), value.Lines...)
	for i := range copy.Lines {
		copy.Lines[i].Words = append([]LyricWord(nil), value.Lines[i].Words...)
	}
	return &copy
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }
func validTimes(start, end float64) bool {
	return finite(start) && finite(end) && start >= 0 && end >= start && end <= 86400
}
