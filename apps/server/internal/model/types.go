package model

import (
	"encoding/json"
	"time"
)

type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Location struct {
	FlagEmoji   string `json:"flagEmoji"`
	FlagSVGURL  string `json:"flagSvgURL"`
	City        string `json:"city"`
	Country     string `json:"country"`
	Region      string `json:"region"`
	CountryCode string `json:"countryCode"`
}

type Client struct {
	Username        string    `json:"username"`
	ClientID        string    `json:"clientId"`
	Avatar          string    `json:"avatar,omitempty"`
	RTT             float64   `json:"rtt"`
	CompensationMS  float64   `json:"compensationMs"`
	NudgeMS         float64   `json:"nudgeMs"`
	Position        Position  `json:"position"`
	LastNTPResponse float64   `json:"lastNtpResponse"`
	IsCreator       bool      `json:"isCreator"`
	Location        *Location `json:"location,omitempty"`
	JoinedAt        float64   `json:"joinedAt"`
}

type AudioSource struct {
	URL            string       `json:"url"`
	Title          string       `json:"title,omitempty"`
	Lyrics         *TrackLyrics `json:"lyrics,omitempty"`
	LyricsState    string       `json:"lyricsState,omitempty"`
	LyricsVersion  uint64       `json:"lyricsVersion,omitempty"`
	LyricsRetryAt  time.Time    `json:"-"`
	LyricsAttempts int          `json:"-"`
}

// TrackLyrics is immutable after it is attached to a source. A positive offset
// delays the displayed lyrics relative to the audio, in seconds.
type TrackLyrics struct {
	Synced          string      `json:"synced"`
	Plain           string      `json:"plain"`
	Offset          float64     `json:"offset"`
	Provider        string      `json:"provider"`
	Language        string      `json:"language,omitempty"`
	SyncType        string      `json:"syncType,omitempty"`
	Lines           []LyricLine `json:"lines,omitempty"`
	ResolverVersion int         `json:"resolverVersion,omitempty"`
	Automatic       bool        `json:"automatic,omitempty"`
}

type LyricWord struct {
	StartTime float64 `json:"startTime"`
	EndTime   float64 `json:"endTime"`
	Text      string  `json:"text"`
}

type LyricLine struct {
	StartTime float64     `json:"startTime"`
	EndTime   float64     `json:"endTime"`
	Text      string      `json:"text"`
	Words     []LyricWord `json:"words,omitempty"`
}

type LyricsMetadata struct {
	Title    string  `json:"title,omitempty"`
	Track    string  `json:"track,omitempty"`
	Artist   string  `json:"artist,omitempty"`
	Duration float64 `json:"duration,omitempty"`
	Language string  `json:"language,omitempty"`
}

type YouTubeLyricsResult struct {
	Lyrics   *TrackLyrics   `json:"lyrics,omitempty"`
	Metadata LyricsMetadata `json:"metadata"`
}

type PlaybackState struct {
	Type                 string  `json:"type"`
	AudioSource          string  `json:"audioSource"`
	ServerTimeToExecute  float64 `json:"serverTimeToExecute"`
	TrackPositionSeconds float64 `json:"trackPositionSeconds"`
}

type ChatReply struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Text     string `json:"text"`
}

type ChatMessage struct {
	ID          int64      `json:"id"`
	ClientID    string     `json:"clientId"`
	Username    string     `json:"username"`
	Text        string     `json:"text"`
	Timestamp   float64    `json:"timestamp"`
	CountryCode string     `json:"countryCode,omitempty"`
	IsCreator   bool       `json:"isCreator"`
	ReplyTo     *ChatReply `json:"replyTo,omitempty"`
}

type WSRequest struct {
	Type                  string          `json:"type"`
	T0                    float64         `json:"t0"`
	ClientRTT             *float64        `json:"clientRTT"`
	ClientCompensationMS  *float64        `json:"clientCompensationMs"`
	ClientNudgeMS         *float64        `json:"clientNudgeMs"`
	ProbeGroupID          int64           `json:"probeGroupId"`
	ProbeGroupIndex       int             `json:"probeGroupIndex"`
	TrackTimeSeconds      float64         `json:"trackTimeSeconds"`
	AudioSource           string          `json:"audioSource"`
	Source                AudioSource     `json:"source"`
	ClientID              string          `json:"clientId"`
	Position              Position        `json:"position"`
	X                     float64         `json:"x"`
	Y                     float64         `json:"y"`
	Location              *Location       `json:"location"`
	Query                 string          `json:"query"`
	Offset                int             `json:"offset"`
	TrackID               json.RawMessage `json:"trackId"`
	TrackName             string          `json:"trackName"`
	Volume                float64         `json:"volume"`
	Text                  string          `json:"text"`
	ReplyToMessageID      *int64          `json:"replyToMessageId"`
	URLs                  []string        `json:"urls"`
	ReorderedAudioSources []AudioSource   `json:"reorderedAudioSources"`
	Enabled               bool            `json:"enabled"`
	Freq                  float64         `json:"freq"`
	TargetClientID        string          `json:"targetClientId"`
	Signal                any             `json:"signal"`
	Tracks                []SpotifyTrack  `json:"tracks"`
	Sources               []AudioSource   `json:"sources"`
	Avatar                string          `json:"avatar"`
	Lyrics                *TrackLyrics    `json:"lyrics"`
	OnlyIfEmpty           bool            `json:"onlyIfEmpty"`
}

type SpotifyTrack struct {
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	CoverURL string `json:"coverUrl,omitempty"`
}

type RoomBackup struct {
	ClientDatas   []Client      `json:"clientDatas"`
	AudioSources  []AudioSource `json:"audioSources"`
	GlobalVolume  float64       `json:"globalVolume"`
	LowPassFreq   float64       `json:"lowPassFreq"`
	PlaybackState PlaybackState `json:"playbackState"`
}

type ServerBackup struct {
	Timestamp float64 `json:"timestamp"`
	Data      struct {
		Rooms map[string]RoomBackup `json:"rooms"`
	} `json:"data"`
}
