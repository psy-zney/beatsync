package lyrics

import (
	"strings"
	"unicode"
)

func baseLanguage(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.Split(value, "-")[0]
}

// Only infer languages with strong textual evidence. An unknown language is
// preferable to treating every Latin-script song as English.
func detectLanguage(text string) string {
	counts := map[string]int{}
	letters := 0
	for _, r := range strings.ToLower(text) {
		if unicode.IsLetter(r) {
			letters++
		}
		switch {
		case strings.ContainsRune("ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉĩịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ", r):
			counts["vi"]++
		case r >= 0x3040 && r <= 0x30ff:
			counts["ja"]++
		case r >= 0xac00 && r <= 0xd7af:
			counts["ko"]++
		case r >= 0x4e00 && r <= 0x9fff:
			counts["zh"]++
		case r >= 0x0400 && r <= 0x04ff:
			counts["ru"]++
		case r >= 0x0600 && r <= 0x06ff:
			counts["ar"]++
		case r >= 0x0e00 && r <= 0x0e7f:
			counts["th"]++
		}
	}
	if counts["vi"] >= 2 && counts["vi"]*100 >= max(1, letters) {
		return "vi"
	}
	for _, lang := range []string{"ja", "ko", "th", "ru", "ar", "zh"} {
		count := counts[lang]
		if lang == "ja" && count >= 2 {
			count += counts["zh"]
		}
		if counts[lang] >= 2 && count*5 >= max(1, letters) {
			return lang
		}
	}
	english := 0
	for _, word := range strings.Fields(normalizeSearchString(text)) {
		switch word {
		case "the", "you", "your", "i", "my", "me", "and", "is", "are", "don't", "with", "love":
			english++
		}
	}
	if english >= 4 {
		return "en"
	}
	return ""
}

func languageMatches(text, expected string) bool {
	expected = baseLanguage(expected)
	actual := detectLanguage(text)
	// A Vietnamese title/track must not silently receive an English translation.
	if expected == "vi" {
		return actual == "vi"
	}
	if actual == "zh" && expected == "yue" {
		return true
	}
	if actual == "ru" && (expected == "uk" || expected == "bg" || expected == "sr" || expected == "mk") {
		return true
	}
	if actual == "ar" && (expected == "fa" || expected == "ur") {
		return true
	}
	return actual == "" || expected == "" || actual == expected
}

func normalizeSearchString(value string) string {
	var result strings.Builder
	for _, r := range strings.ToLower(value) {
		switch {
		case strings.ContainsRune("àáảãạăằắẳẵặâầấẩẫậ", r):
			r = 'a'
		case strings.ContainsRune("èéẻẽẹêềếểễệ", r):
			r = 'e'
		case strings.ContainsRune("ìíỉĩị", r):
			r = 'i'
		case strings.ContainsRune("òóỏõọôồốổỗộơờớởỡợ", r):
			r = 'o'
		case strings.ContainsRune("ùúủũụưừứửữự", r):
			r = 'u'
		case strings.ContainsRune("ỳýỷỹỵ", r):
			r = 'y'
		case r == 'đ':
			r = 'd'
		}
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			result.WriteRune(r)
		} else {
			result.WriteByte(' ')
		}
	}
	return strings.Join(strings.Fields(result.String()), " ")
}
