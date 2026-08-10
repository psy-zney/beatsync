package memory

import (
	"bufio"
	"context"
	"log"
	"os"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/config"
	"github.com/psy-zney/beatsync/apps/server/internal/queue"
)

type Status struct {
	Level          string `json:"level"`
	RSSBytes       uint64 `json:"rssBytes"`
	HeapBytes      uint64 `json:"heapBytes"`
	SoftLimitBytes uint64 `json:"softLimitBytes"`
	HardLimitBytes uint64 `json:"hardLimitBytes"`
	LastAction     string `json:"lastAction,omitempty"`
	LastCheckedAt  string `json:"lastCheckedAt"`
}

type Monitor struct {
	cfg    config.Config
	queue  *queue.Queue
	backup func(context.Context) error
	mu     sync.RWMutex
	status Status
}

func New(cfg config.Config, jobs *queue.Queue, backup func(context.Context) error) *Monitor {
	return &Monitor{cfg: cfg, queue: jobs, backup: backup, status: Status{Level: "normal", SoftLimitBytes: cfg.MemorySoftLimitBytes, HardLimitBytes: cfg.MemoryHardLimitBytes}}
}

func (m *Monitor) Run(ctx context.Context) {
	m.check(ctx)
	ticker := time.NewTicker(m.cfg.MemoryCheckInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.check(ctx)
		}
	}
}

func (m *Monitor) Status() Status { m.mu.RLock(); defer m.mu.RUnlock(); return m.status }

func (m *Monitor) check(ctx context.Context) {
	rss := processRSS()
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	if rss == 0 {
		rss = stats.Sys
	}
	level, action := "normal", ""
	switch {
	case rss >= m.cfg.MemoryHardLimitBytes:
		level, action = "critical", "cancelled active downloads and dropped queued downloads"
		dropped := m.queue.Pause("hard memory limit", true)
		debug.FreeOSMemory()
		log.Printf("critical memory pressure: rss=%d MiB, dropped=%d", rss>>20, dropped)
		if m.backup != nil {
			backupCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
			if err := m.backup(backupCtx); err != nil {
				log.Printf("emergency local backup failed: %v", err)
			}
			cancel()
		}
	case rss >= m.cfg.MemorySoftLimitBytes:
		level, action = "elevated", "dropped pending downloads and released unused memory"
		dropped := m.queue.ShedPending(max(1, m.queue.Stats().Pending/2))
		debug.FreeOSMemory()
		log.Printf("memory pressure: rss=%d MiB, dropped=%d", rss>>20, dropped)
	default:
		m.queue.Resume()
	}
	m.mu.Lock()
	m.status = Status{Level: level, RSSBytes: rss, HeapBytes: stats.HeapAlloc, SoftLimitBytes: m.cfg.MemorySoftLimitBytes, HardLimitBytes: m.cfg.MemoryHardLimitBytes, LastAction: action, LastCheckedAt: time.Now().UTC().Format(time.RFC3339)}
	m.mu.Unlock()
}

func processRSS() uint64 {
	file, err := os.Open("/proc/self/status")
	if err != nil {
		return 0
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) >= 2 && fields[0] == "VmRSS:" {
			value, _ := strconv.ParseUint(fields[1], 10, 64)
			return value * 1024
		}
	}
	return 0
}
