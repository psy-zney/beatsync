package lyrics

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

func ParseJSON3(raw []byte) (string, string, []ParsedLine, error) {
	if len(raw) > 1<<20 {
		return "", "", nil, fmt.Errorf("subtitle file exceeds size limit")
	}
	var value struct {
		Events []struct {
			Start    float64 `json:"tStartMs"`
			Duration float64 `json:"dDurationMs"`
			Append   int     `json:"aAppend"`
			Segments []struct {
				Text   string  `json:"utf8"`
				Offset float64 `json:"tOffsetMs"`
			} `json:"segs"`
		} `json:"events"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", "", nil, fmt.Errorf("invalid caption JSON")
	}
	var lines []ParsedLine
	for _, event := range value.Events {
		if len(event.Segments) == 0 || event.Duration <= 0 {
			continue
		}
		line := ParsedLine{StartTime: event.Start / 1000, EndTime: (event.Start + event.Duration) / 1000}
		if line.StartTime < 0 || line.EndTime > 86400 {
			return "", "", nil, fmt.Errorf("invalid caption timing")
		}
		var text strings.Builder
		for _, segment := range event.Segments {
			text.WriteString(segment.Text)
			if strings.TrimSpace(segment.Text) == "" {
				continue
			}
			start := (event.Start + segment.Offset) / 1000
			if start < line.StartTime || start > line.EndTime || (len(line.Words) > 0 && start < line.Words[len(line.Words)-1].StartTime) {
				return "", "", nil, fmt.Errorf("invalid caption word timing")
			}
			if len(line.Words) > 0 {
				line.Words[len(line.Words)-1].EndTime = start
			}
			line.Words = append(line.Words, model.LyricWord{StartTime: start, EndTime: line.EndTime, Text: segment.Text})
		}
		line.Text = cleanSubtitleText(text.String())
		if line.Text == "" {
			continue
		}
		if len(line.Words) < 2 || line.Words[len(line.Words)-1].StartTime == line.StartTime {
			line.Words = nil
		}
		if event.Append != 0 && len(lines) > 0 {
			previous := &lines[len(lines)-1]
			previous.Text += line.Text
			previous.EndTime = line.EndTime
			previous.Words = append(previous.Words, line.Words...)
		} else {
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 {
		return "", "", nil, fmt.Errorf("no usable caption events")
	}
	lines = deduplicateRollingCues(lines)
	synced, plain := formatLines(lines)
	return synced, plain, lines, nil
}
