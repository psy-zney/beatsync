package app

import (
	"context"
	"log"
	"net/http"
	"path/filepath"
	"runtime/debug"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/psy-zney/beatsync/apps/server/internal/backup"
	"github.com/psy-zney/beatsync/apps/server/internal/config"
	"github.com/psy-zney/beatsync/apps/server/internal/hybrid"
	"github.com/psy-zney/beatsync/apps/server/internal/lyrics"
	"github.com/psy-zney/beatsync/apps/server/internal/memory"
	"github.com/psy-zney/beatsync/apps/server/internal/queue"
	"github.com/psy-zney/beatsync/apps/server/internal/realtime"
	"github.com/psy-zney/beatsync/apps/server/internal/room"
	"github.com/psy-zney/beatsync/apps/server/internal/spotify"
	"github.com/psy-zney/beatsync/apps/server/internal/storage"
	"github.com/psy-zney/beatsync/apps/server/internal/youtube"
)

type App struct {
	Config        config.Config
	Rooms         *room.Manager
	Hub           *realtime.Hub
	Queue         *queue.Queue
	Store         *storage.Client
	YouTube       *youtube.Service
	Spotify       *spotify.Service
	Lyrics        *lyrics.Service
	Backup        *backup.Manager
	Memory        *memory.Monitor
	Hybrid        *hybrid.Broker
	HTTP          *http.Client
	startedAt     time.Time
	upgrader      websocket.Upgrader
	background    sync.WaitGroup
	lyricsWake    chan struct{}
	lyricsContext context.Context
	lyricsCancel  context.CancelFunc
	lyricsWorkers sync.WaitGroup
	importMu      sync.Mutex
	importCancels map[string]context.CancelFunc
}

func New(cfg config.Config) (*App, error) {
	rooms := room.NewManager()
	jobs := queue.New(cfg.StreamConcurrency, cfg.StreamQueueSize)
	var store *storage.Client
	if cfg.StorageConfigured() {
		var err error
		store, err = storage.New(cfg)
		if err != nil {
			return nil, err
		}
	}
	backups := backup.New(rooms, store, cfg.LocalBackupPath)
	application := &App{
		Config: cfg, Rooms: rooms, Hub: realtime.NewHub(), Queue: jobs, Store: store,
		YouTube: youtube.New(cfg), Spotify: spotify.New(cfg), Lyrics: lyrics.NewService(cfg.YTDLPPath, cfg.CookiesPath, lyrics.WithCacheDirectory(filepath.Join(filepath.Dir(cfg.LocalBackupPath), "lyrics-cache")), lyrics.WithConcurrency(cfg.LyricsConcurrency)),
		Backup:        backups,
		Hybrid:        hybrid.NewBroker(cfg.HybridWorkerSecret),
		HTTP:          &http.Client{Transport: &http.Transport{MaxIdleConns: 16, MaxIdleConnsPerHost: 4, IdleConnTimeout: 60 * time.Second, ResponseHeaderTimeout: 20 * time.Second}},
		startedAt:     time.Now(),
		importCancels: make(map[string]context.CancelFunc),
	}
	application.Memory = memory.New(cfg, jobs, func(context.Context) error { return backups.SaveLocal() })
	application.upgrader = websocket.Upgrader{ReadBufferSize: 1024, WriteBufferSize: 2048, CheckOrigin: func(*http.Request) bool { return true }}
	application.Lyrics.SetYouTubeFetcher(application.fetchYouTubeLyrics)
	application.startAutoLyrics()
	return application, nil
}

func (a *App) Restore(ctx context.Context) {
	if a.Config.Demo {
		return
	}
	restored, err := a.Backup.Restore(ctx)
	if err != nil {
		log.Printf("state restore failed: %v", err)
		return
	}
	if restored {
		log.Printf("state restored: %d room(s)", a.Rooms.Count())
		for _, r := range a.Rooms.Rooms() {
			go a.triggerAutoLyrics(r.ID, r)
		}
	}
}

func (a *App) RunBackground(ctx context.Context) {
	a.background.Add(3)
	go func() { defer a.background.Done(); a.Memory.Run(ctx) }()
	go func() {
		defer a.background.Done()
		ticker := time.NewTicker(a.Config.BackupInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				backupCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
				if err := a.Backup.Save(backupCtx); err != nil {
					log.Printf("periodic backup failed: %v", err)
				}
				cancel()
			}
		}
	}()
	go func() {
		defer a.background.Done()
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				for _, state := range a.Rooms.Rooms() {
					state.PruneDisconnected(time.Now().Add(-10 * time.Minute))
				}
				removed := a.Rooms.CleanupIdle(a.Config.RoomIdleTTL, func(room *room.Room) {
					if room.ID == persistentRoomID {
						// Persistent room 090624: save playlist and preserve permanently on R2
						a.savePlaylist(context.Background(), room)
						log.Printf("[Special Room] %s preserved on R2", room.ID)
					} else {
						// Regular empty room (> 5 minutes): purge room storage on R2
						a.wipeRoomR2Storage(context.Background(), room.ID, room)
					}
					a.cancelRoomJobs(room.ID)
				})
				if removed > 0 {
					log.Printf("released %d idle room(s)", removed)
					debug.FreeOSMemory()
				}
			}
		}
	}()
}

func (a *App) registerImportCancel(roomID string, cancel context.CancelFunc) {
	a.importMu.Lock()
	if old, ok := a.importCancels[roomID]; ok {
		old()
	}
	a.importCancels[roomID] = cancel
	a.importMu.Unlock()
}

func (a *App) unregisterImportCancel(roomID string) {
	a.importMu.Lock()
	delete(a.importCancels, roomID)
	a.importMu.Unlock()
}

func (a *App) cancelSpotifyImport(roomID string) {
	a.importMu.Lock()
	if cancel, ok := a.importCancels[roomID]; ok {
		cancel()
		delete(a.importCancels, roomID)
	}
	a.importMu.Unlock()
}

func (a *App) cancelRoomJobs(roomID string) {
	if roomID == "" {
		return
	}
	// 1. Abort any running Spotify import goroutine for this room
	a.cancelSpotifyImport(roomID)

	// 2. Kill in-flight yt-dlp processes and R2 uploads, drop queued stream jobs
	if a.Queue != nil {
		a.Queue.CancelJobsWithPrefix(roomID + ":")
	}

	// 3. Clear room's stream jobs map and broadcast reset
	if state, ok := a.Rooms.Get(roomID); ok {
		state.ClearStreamJobs()
		a.Hub.Broadcast(roomID, map[string]any{"type": "STREAM_JOB_UPDATE", "activeJobCount": 0})
	}

	// 4. Trigger memory release
	debug.FreeOSMemory()
	log.Printf("cancelled all background jobs and released resources for room=%s", roomID)
}

func (a *App) Shutdown(ctx context.Context) {
	if a.lyricsCancel != nil {
		a.lyricsCancel()
		done := make(chan struct{})
		go func() { a.lyricsWorkers.Wait(); close(done) }()
		select {
		case <-done:
		case <-ctx.Done():
		}
	}
	a.Queue.Close()
	a.Hub.Close()
	a.Hybrid.Close()
	if !a.Config.Demo {
		done := make(chan struct{})
		go func() {
			defer close(done)
			if err := a.Backup.Save(ctx); err != nil {
				log.Printf("final backup failed: %v", err)
			}
		}()
		select {
		case <-done:
		case <-ctx.Done():
		}
	}
	a.HTTP.CloseIdleConnections()
}

func (a *App) Wait() { a.background.Wait() }
