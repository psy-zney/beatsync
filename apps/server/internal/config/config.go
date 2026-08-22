package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// LoadEnvFile loads a dotenv file without overriding values supplied by the
// service manager. Keeping this tiny avoids pulling a dependency into the
// production binary.
func LoadEnvFile(name string) error {
	file, err := os.Open(name)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, found := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !found || key == "" || os.Getenv(key) != "" {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && ((value[0] == '\'' && value[len(value)-1] == '\'') || (value[0] == '"' && value[len(value)-1] == '"')) {
			value = value[1 : len(value)-1]
		}
		if err := os.Setenv(key, value); err != nil {
			return err
		}
	}
	return scanner.Err()
}

type Config struct {
	Host                     string
	Port                     int
	Demo                     bool
	DemoRoomID               string
	DemoAudioDir             string
	CreatorSecret            string
	ProviderURL              string
	SpotifyClientID          string
	SpotifyClientSecret      string
	LiveKitURL               string
	LiveKitAPIKey            string
	LiveKitAPISecret         string
	S3Bucket                 string
	S3PublicURL              string
	S3Endpoint               string
	S3AccessKey              string
	S3SecretKey              string
	S3Region                 string
	LocalBackupPath          string
	ExtractorPath            string
	YTDLPPath                string
	CookiesPath              string
	StreamConcurrency        int
	StreamQueueSize          int
	MaxAudioDownloadBytes    int64
	MemorySoftLimitBytes     uint64
	MemoryHardLimitBytes     uint64
	MemoryCheckInterval      time.Duration
	RoomIdleTTL              time.Duration
	BackupInterval           time.Duration
	HTTPTimeout              time.Duration
	ExtractorTimeout         time.Duration
	MaxConnectionsPerRoom    int
	MaxWebSocketMessageSize  int64
	HybridWorkerSecret       string
	HybridJobLease           time.Duration
	WorkerServerURL          string
	WorkerID                 string
	WorkerConcurrency        int
	WorkerAccessClientID     string
	WorkerAccessClientSecret string
}

func Load() (Config, error) {
	c := Config{
		Host:                     env("HOST", "127.0.0.1"),
		Port:                     envInt("PORT", 1001),
		Demo:                     envBool("DEMO", false),
		DemoRoomID:               env("DEMO_ROOM_ID", "000000"),
		DemoAudioDir:             env("DEMO_AUDIO_DIR", "./demo-audio"),
		CreatorSecret:            os.Getenv("CREATOR_SECRET"),
		ProviderURL:              os.Getenv("PROVIDER_URL"),
		SpotifyClientID:          os.Getenv("SPOTIFY_CLIENT_ID"),
		SpotifyClientSecret:      os.Getenv("SPOTIFY_CLIENT_SECRET"),
		LiveKitURL:               os.Getenv("LIVEKIT_URL"),
		LiveKitAPIKey:            os.Getenv("LIVEKIT_API_KEY"),
		LiveKitAPISecret:         os.Getenv("LIVEKIT_API_SECRET"),
		S3Bucket:                 os.Getenv("S3_BUCKET_NAME"),
		S3PublicURL:              strings.TrimRight(os.Getenv("S3_PUBLIC_URL"), "/"),
		S3Endpoint:               strings.TrimRight(os.Getenv("S3_ENDPOINT"), "/"),
		S3AccessKey:              os.Getenv("S3_ACCESS_KEY_ID"),
		S3SecretKey:              os.Getenv("S3_SECRET_ACCESS_KEY"),
		S3Region:                 env("S3_REGION", "auto"),
		LocalBackupPath:          env("LOCAL_BACKUP_PATH", "./data/state-backup-latest.json"),
		ExtractorPath:            env("YT_EXTRACTOR_PATH", executableSibling("yt-rust-extractor")),
		YTDLPPath:                env("YTDLP_PATH", executableSibling("yt-dlp")),
		CookiesPath:              env("YOUTUBE_COOKIES_PATH", "../../cookies.txt"),
		StreamConcurrency:        envInt("STREAM_MAX_CONCURRENCY", 1),
		StreamQueueSize:          envInt("STREAM_MAX_QUEUE", 12),
		MaxAudioDownloadBytes:    int64(envInt("MAX_AUDIO_DOWNLOAD_MB", 120)) * 1024 * 1024,
		MemorySoftLimitBytes:     uint64(envInt("MEMORY_SOFT_LIMIT_MB", 220)) * 1024 * 1024,
		MemoryHardLimitBytes:     uint64(envInt("MEMORY_HARD_LIMIT_MB", 320)) * 1024 * 1024,
		MemoryCheckInterval:      envDuration("MEMORY_CHECK_INTERVAL", 5*time.Second),
		RoomIdleTTL:              envDuration("ROOM_IDLE_TTL", 2*time.Minute),
		BackupInterval:           envDuration("BACKUP_INTERVAL", 2*time.Minute),
		HTTPTimeout:              envDuration("UPSTREAM_TIMEOUT", 15*time.Second),
		ExtractorTimeout:         envDuration("EXTRACTOR_TIMEOUT", 30*time.Second),
		MaxConnectionsPerRoom:    envInt("MAX_CONNECTIONS_PER_ROOM", 100),
		MaxWebSocketMessageSize:  int64(envInt("MAX_WS_MESSAGE_KB", 256)) * 1024,
		HybridWorkerSecret:       os.Getenv("HYBRID_WORKER_SECRET"),
		HybridJobLease:           envDuration("HYBRID_JOB_LEASE", 20*time.Second),
		WorkerServerURL:          os.Getenv("WORKER_SERVER_URL"),
		WorkerID:                 env("WORKER_ID", "local-primary"),
		WorkerConcurrency:        envInt("WORKER_CONCURRENCY", 2),
		WorkerAccessClientID:     os.Getenv("CF_ACCESS_CLIENT_ID"),
		WorkerAccessClientSecret: os.Getenv("CF_ACCESS_CLIENT_SECRET"),
	}
	if c.Port < 1 || c.Port > 65535 {
		return Config{}, fmt.Errorf("invalid PORT %d", c.Port)
	}
	if c.MemoryHardLimitBytes <= c.MemorySoftLimitBytes {
		return Config{}, fmt.Errorf("MEMORY_HARD_LIMIT_MB must exceed MEMORY_SOFT_LIMIT_MB")
	}
	if c.WorkerServerURL != "" && strings.TrimSpace(c.HybridWorkerSecret) == "" {
		return Config{}, fmt.Errorf("HYBRID_WORKER_SECRET is required in worker mode")
	}
	if c.WorkerConcurrency < 1 || c.WorkerConcurrency > 32 {
		return Config{}, fmt.Errorf("WORKER_CONCURRENCY must be between 1 and 32")
	}
	if (c.WorkerAccessClientID == "") != (c.WorkerAccessClientSecret == "") {
		return Config{}, fmt.Errorf("CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be configured together")
	}
	return c, nil
}

func (c Config) Address() string { return fmt.Sprintf("%s:%d", c.Host, c.Port) }
func (c Config) StorageConfigured() bool {
	return c.S3Bucket != "" && c.S3Endpoint != "" && c.S3AccessKey != "" && c.S3SecretKey != ""
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envInt(name string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func envBool(name string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	if value == "" {
		return fallback
	}
	return value == "1" || value == "true" || value == "yes"
}

func envDuration(name string, fallback time.Duration) time.Duration {
	value, err := time.ParseDuration(strings.TrimSpace(os.Getenv(name)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func executableSibling(name string) string {
	if os.PathSeparator == '\\' {
		name += ".exe"
	}
	executable, err := os.Executable()
	if err != nil {
		return name
	}
	return filepath.Join(filepath.Dir(executable), name)
}
