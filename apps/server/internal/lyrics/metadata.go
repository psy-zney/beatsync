package lyrics

import "strings"

// inferCreditedTrack resolves artist/song fields from a decorated video title.
// A channel name alone is insufficient: it must match a complete artist credit.
func inferCreditedTrack(title, channel string) (track, artist string) {
	channel = strings.TrimSpace(channel)
	channel = strings.TrimSuffix(channel, " - Topic")
	if strings.HasSuffix(strings.ToLower(channel), "vevo") {
		channel = strings.TrimSpace(channel[:len(channel)-4])
	}
	if channel == "" {
		return "", ""
	}
	parts := strings.Split(BuildSearchQuery(title), " - ")
	// Imports can prefix the artist to a title that already contains its credits.
	for len(parts) > 2 && normalizeSearchString(parts[0]) == normalizeSearchString(channel) && hasArtistCredit(parts[1], channel) {
		parts = parts[1:]
	}
	if len(parts) != 2 {
		return "", ""
	}
	if hasArtistCredit(parts[0], channel) && !hasArtistCredit(parts[1], channel) {
		return strings.TrimSpace(parts[1]), channel
	}
	if hasArtistCredit(parts[1], channel) && !hasArtistCredit(parts[0], channel) {
		return strings.TrimSpace(parts[0]), channel
	}
	return "", ""
}

func hasArtistCredit(credits, artist string) bool {
	wanted := normalizeSearchString(artist)
	if wanted == "" {
		return false
	}
	if normalizeSearchString(stripFeaturedArtist(credits)) == wanted {
		return true
	}
	for _, credit := range strings.FieldsFunc(credits, func(r rune) bool { return r == ',' || r == '&' || r == ';' || r == '/' }) {
		if normalizeSearchString(stripFeaturedArtist(credit)) == wanted {
			return true
		}
	}
	return false
}
