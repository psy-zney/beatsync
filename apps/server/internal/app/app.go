package app

import (
	"context"
	"log"
	"net/http"
	"runtime/debug"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/psy-zney/beatsync/apps/server/internal/backup"
	"github.com/psy-zney/beatsync/apps/server/internal/config"
	"github.com/psy-zney/beatsync/apps/server/internal/hybrid"
	"github.com/psy-zney/beatsync/apps/server/internal/memory"
	"github.com/psy-zney/beatsync/apps/server/internal/queue"
	"github.com/psy-zney/beatsync/apps/server/internal/realtime"
	"github.com/psy-zney/beatsync/apps/server/internal/room"
	"github.com/psy-zney/beatsync/apps/server/internal/spotify"
	"github.com/psy-zney/beatsync/apps/server/internal/storage"
	"github.com/psy-zney/beatsync/apps/server/internal/youtube"
)

type App struct {
	Config     config.Config
	Rooms      *room.Manager
	Hub        *realtime.Hub
	Queue      *queue.Queue
	Store      *storage.Client
	YouTube    *youtube.Service
	Spotify    *spotify.Service
	Backup     *backup.Manager
	Memory     *memory.Monitor
	Hybrid     *hybrid.Broker
	HTTP       *http.Client
	startedAt  time.Time
	upgrader   websocket.Upgrader
	schedule   func(time.Duration, func())
	background sync.WaitGroup
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
		YouTube: youtube.New(cfg), Spotify: spotify.New(cfg), Backup: backups,
		Hybrid:    hybrid.NewBroker(cfg.HybridWorkerSecret),
		HTTP:      &http.Client{Transport: &http.Transport{MaxIdleConns: 16, MaxIdleConnsPerHost: 4, IdleConnTimeout: 60 * time.Second, ResponseHeaderTimeout: 20 * time.Second}},
		startedAt: time.Now(),
		schedule:  func(delay time.Duration, callback func()) { time.AfterFunc(delay, callback) },
	}
	application.Memory = memory.New(cfg, jobs, func(context.Context) error { return backups.SaveLocal() })
	application.upgrader = websocket.Upgrader{ReadBufferSize: 1024, WriteBufferSize: 2048, CheckOrigin: func(*http.Request) bool { return true }}
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
				removed := a.Rooms.CleanupIdle(a.Config.RoomIdleTTL, func(room *room.Room) { a.savePlaylist(context.Background(), room) })
				if removed > 0 {
					log.Printf("released %d idle room(s)", removed)
					debug.FreeOSMemory()
				}
			}
		}
	}()
}

func (a *App) Shutdown(ctx context.Context) {
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
