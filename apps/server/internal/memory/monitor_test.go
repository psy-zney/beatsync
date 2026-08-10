package memory

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/psy-zney/beatsync/apps/server/internal/config"
	"github.com/psy-zney/beatsync/apps/server/internal/queue"
)

func TestHardLimitPausesQueueAndWritesEmergencyBackup(t *testing.T) {
	jobs := queue.New(1, 1)
	defer jobs.Close()
	var backups atomic.Int64
	monitor := New(config.Config{MemorySoftLimitBytes: 1, MemoryHardLimitBytes: 2}, jobs, func(context.Context) error { backups.Add(1); return nil })
	monitor.check(context.Background())
	status := monitor.Status()
	if status.Level != "critical" {
		t.Fatalf("level=%s", status.Level)
	}
	if !jobs.Stats().Paused {
		t.Fatal("queue was not paused")
	}
	if backups.Load() != 1 {
		t.Fatalf("backup calls=%d", backups.Load())
	}
}
