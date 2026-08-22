package hybrid

import (
	"encoding/json"
	"errors"
)

const (
	KindSpotifyResolve  = "spotify.resolve"
	KindYouTubeSearch   = "youtube.search"
	KindYouTubeResolve  = "youtube.resolve"
	KindYouTubeMetadata = "youtube.metadata"
)

var ErrWorkerUnavailable = errors.New("hybrid worker unavailable")

type Message struct {
	Type           string          `json:"type"`
	JobID          string          `json:"jobId,omitempty"`
	Kind           string          `json:"kind,omitempty"`
	Payload        json.RawMessage `json:"payload,omitempty"`
	Result         json.RawMessage `json:"result,omitempty"`
	Error          string          `json:"error,omitempty"`
	DeadlineUnixMS int64           `json:"deadlineUnixMs,omitempty"`
}

type SpotifyResolveInput struct {
	URL       string `json:"url"`
	MaxTracks int    `json:"maxTracks"`
}

type YouTubeSearchInput struct {
	Query  string `json:"query"`
	Offset int    `json:"offset"`
}

type YouTubeInput struct {
	Input string `json:"input"`
}

type YouTubeMetadataResult struct {
	Title   string `json:"title"`
	VideoID string `json:"videoId"`
}

type RemoteError struct{ Message string }

func (e *RemoteError) Error() string { return "hybrid worker: " + e.Message }
