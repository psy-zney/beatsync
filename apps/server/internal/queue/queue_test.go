package queue

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestShedPendingNotifiesDroppedJob(t *testing.T) {
	q := New(1, 2)
	defer q.Close()
	started := make(chan struct{})
	release := make(chan struct{})
	if err := q.Submit(Job{ID: "active", Run: func(context.Context) error { close(started); <-release; return nil }}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("worker did not start")
	}
	var dropped atomic.Int64
	for _, id := range []string{"waiting-1", "waiting-2"} {
		if err := q.Submit(Job{ID: id, Run: func(context.Context) error { return nil }, Drop: func(error) { dropped.Add(1) }}); err != nil {
			t.Fatal(err)
		}
	}
	if got := q.ShedPending(1); got != 1 {
		t.Fatalf("dropped %d jobs", got)
	}
	if dropped.Load() != 1 {
		t.Fatalf("drop callback count = %d", dropped.Load())
	}
	close(release)
}

func TestQueueRejectsOverflow(t *testing.T) {
	q := New(1, 1)
	defer q.Close()
	started := make(chan struct{})
	release := make(chan struct{})
	_ = q.Submit(Job{ID: "active", Run: func(context.Context) error { close(started); <-release; return nil }})
	<-started
	if err := q.Submit(Job{ID: "pending", Run: func(context.Context) error { return nil }}); err != nil {
		t.Fatal(err)
	}
	if err := q.Submit(Job{ID: "overflow", Run: func(context.Context) error { return nil }}); err != ErrFull {
		t.Fatalf("overflow error = %v", err)
	}
	close(release)
}
