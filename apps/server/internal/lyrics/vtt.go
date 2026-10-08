package lyrics

import (
	"fmt"
	"html"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

var (
	htmlTagRegex      = regexp.MustCompile(`<[^>]+>`)
	vttTimestampRegex = regexp.MustCompile(`^(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})$`)
	wordTagRegex      = regexp.MustCompile(`<((?:\d{1,2}:)?\d{2}:\d{2}\.\d{3})>`)
	musicMarkerRegex  = regexp.MustCompile(`(?i)^[\[(](?:âm nhạc|music|vỗ tay|tiếng vỗ tay|applause|instrumental)[\])]$`)
)

type ParsedLine = model.LyricLine

// ParseVTT rejects malformed cues and keeps actual word timestamps. Repeated
// chorus lines are retained unless the cues overlap or carry a rolling line.
func ParseVTT(raw string) (string, string, []ParsedLine, error) {
	if len(raw) > 1<<20 {
		return "", "", nil, fmt.Errorf("subtitle file exceeds size limit")
	}
	raw = strings.ReplaceAll(strings.TrimPrefix(raw, "\ufeff"), "\r\n", "\n")
	var cues []ParsedLine
	for _, block := range strings.Split(raw, "\n\n") {
		rows := strings.Split(strings.TrimSpace(block), "\n")
		if len(rows) == 0 || strings.HasPrefix(rows[0], "NOTE") || strings.HasPrefix(rows[0], "STYLE") || strings.HasPrefix(rows[0], "REGION") {
			continue
		}
		timing := -1
		for i, row := range rows {
			if strings.Contains(row, "-->") {
				timing = i
				break
			}
		}
		if timing < 0 {
			continue
		}
		parts := strings.SplitN(rows[timing], "-->", 2)
		startFields, endFields := strings.Fields(parts[0]), strings.Fields(parts[1])
		if len(startFields) != 1 || len(endFields) == 0 {
			return "", "", nil, fmt.Errorf("invalid subtitle cue")
		}
		start, err1 := parseVTTTime(startFields[0])
		end, err2 := parseVTTTime(endFields[0])
		if err1 != nil || err2 != nil || end <= start || end > 86400 {
			return "", "", nil, fmt.Errorf("invalid subtitle timing")
		}
		payload := strings.Join(rows[timing+1:], "\n")
		text := cleanSubtitleText(payload)
		if text == "" {
			continue
		}
		cues = append(cues, ParsedLine{StartTime: start, EndTime: end, Text: text, Words: parseVTTWords(payload, start, end)})
	}
	if len(cues) == 0 {
		return "", "", nil, fmt.Errorf("no usable lyric cues")
	}
	sort.SliceStable(cues, func(i, j int) bool { return cues[i].StartTime < cues[j].StartTime })
	cues = deduplicateRollingCues(cues)
	synced, plain := formatLines(cues)
	return synced, plain, cues, nil
}

func parseVTTTime(s string) (float64, error) {
	match := vttTimestampRegex.FindStringSubmatch(s)
	if match == nil {
		return 0, fmt.Errorf("invalid subtitle timestamp")
	}
	hours, _ := strconv.Atoi(match[1])
	mins, _ := strconv.Atoi(match[2])
	secs, _ := strconv.Atoi(match[3])
	ms, _ := strconv.Atoi(match[4])
	if mins >= 60 || secs >= 60 {
		return 0, fmt.Errorf("invalid subtitle timestamp")
	}
	return float64(hours*3600+mins*60+secs) + float64(ms)/1000, nil
}

func cleanSubtitleText(raw string) string {
	text := strings.TrimSpace(html.UnescapeString(htmlTagRegex.ReplaceAllString(raw, "")))
	if musicMarkerRegex.MatchString(text) {
		return ""
	}
	return text
}

func parseVTTWords(raw string, start, end float64) []model.LyricWord {
	matches := wordTagRegex.FindAllStringSubmatchIndex(raw, -1)
	if len(matches) == 0 {
		return nil
	}
	var words []model.LyricWord
	prefix := html.UnescapeString(htmlTagRegex.ReplaceAllString(raw[:matches[0][0]], ""))
	if strings.TrimSpace(prefix) != "" {
		words = append(words, model.LyricWord{StartTime: start, EndTime: end, Text: prefix})
	}
	for i, m := range matches {
		t, err := parseVTTTime(raw[m[2]:m[3]])
		if err != nil || t < start || t > end || (len(words) > 0 && t < words[len(words)-1].StartTime) {
			return nil
		}
		limit := len(raw)
		if i+1 < len(matches) {
			limit = matches[i+1][0]
		}
		text := html.UnescapeString(htmlTagRegex.ReplaceAllString(raw[m[1]:limit], ""))
		if strings.TrimSpace(text) == "" {
			continue
		}
		if len(words) > 0 {
			words[len(words)-1].EndTime = t
		}
		words = append(words, model.LyricWord{StartTime: t, EndTime: end, Text: text})
	}
	return words
}

func deduplicateRollingCues(cues []ParsedLine) []ParsedLine {
	var result []ParsedLine
	for _, cue := range cues {
		rows := strings.Split(cue.Text, "\n")
		var effective []string
		for _, row := range rows {
			row = strings.TrimSpace(row)
			if row == "" {
				continue
			}
			if len(result) > 0 {
				previous := &result[len(result)-1]
				overlap := cue.StartTime < previous.EndTime-0.001
				rolling := len(rows) > 1 && cue.StartTime <= previous.EndTime+0.05
				if strings.EqualFold(previous.Text, row) && (overlap || rolling) {
					previous.EndTime = math.Max(previous.EndTime, cue.EndTime)
					continue
				}
			}
			effective = append(effective, row)
		}
		if len(effective) == 0 {
			continue
		}
		cue.Text = strings.Join(effective, " ")
		if len(effective) != len(rows) {
			cue.Words = nil
		}
		if len(result) > 0 && math.Abs(result[len(result)-1].StartTime-cue.StartTime) < 0.001 {
			previous := &result[len(result)-1]
			previous.Text += " " + cue.Text
			previous.EndTime = math.Max(previous.EndTime, cue.EndTime)
			previous.Words = nil
		} else {
			result = append(result, cue)
		}
	}
	for i := 0; i+1 < len(result); i++ {
		result[i].EndTime = math.Min(result[i].EndTime, result[i+1].StartTime)
		for j := range result[i].Words {
			result[i].Words[j].EndTime = math.Min(result[i].Words[j].EndTime, result[i].EndTime)
		}
		if len(result[i].Words) > 0 && result[i].Words[len(result[i].Words)-1].StartTime > result[i].EndTime {
			result[i].Words = nil
		}
	}
	return result
}

func formatLines(lines []ParsedLine) (string, string) {
	var lrc, plain strings.Builder
	for i, line := range lines {
		lrc.WriteString(formatLRCTimestamp(line.StartTime))
		if len(line.Words) > 0 {
			for _, word := range line.Words {
				lrc.WriteString("<" + strings.Trim(formatLRCTimestamp(word.StartTime), "[]") + ">" + word.Text)
			}
		} else {
			lrc.WriteString(strings.ReplaceAll(line.Text, "\n", "\\n"))
		}
		lrc.WriteByte('\n')
		plain.WriteString(line.Text)
		if i+1 < len(lines) {
			plain.WriteByte('\n')
		}
		if i+1 == len(lines) || lines[i+1].StartTime > line.EndTime+0.05 {
			lrc.WriteString(formatLRCTimestamp(line.EndTime) + "\n")
		}
	}
	return strings.TrimSpace(lrc.String()), strings.TrimSpace(plain.String())
}

func formatLRCTimestamp(seconds float64) string {
	total := int64(math.Round(math.Max(0, seconds) * 100))
	return fmt.Sprintf("[%02d:%02d.%02d]", total/6000, (total/100)%60, total%100)
}
