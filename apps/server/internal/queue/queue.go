package queue

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
)

var ErrFull = errors.New("stream queue is full")
var ErrPaused = errors.New("stream queue is paused")

type Job struct {
	ID   string
	Run  func(context.Context) error
	Drop func(error)
}

type Stats struct {
	Active       int64  `json:"active"`
	Pending      int    `json:"pending"`
	Paused       bool   `json:"paused"`
	PausedReason string `json:"pausedReason,omitempty"`
}

type Queue struct {
	jobs        chan Job
	ctx         context.Context
	cancel      context.CancelFunc
	active      atomic.Int64
	mu          sync.RWMutex
	paused      bool
	pauseReason string
	activeJobs  map[string]context.CancelFunc
}

func New(concurrency, capacity int) *Queue {
	ctx, cancel := context.WithCancel(context.Background())
	q := &Queue{jobs: make(chan Job, capacity), ctx: ctx, cancel: cancel, activeJobs: make(map[string]context.CancelFunc)}
	for range concurrency {
		go q.worker()
	}
	return q
}

func (q *Queue) Submit(job Job) error {
	q.mu.RLock()
	paused := q.paused
	q.mu.RUnlock()
	if paused {
		return ErrPaused
	}
	select {
	case q.jobs <- job:
		return nil
	default:
		return ErrFull
	}
}

func (q *Queue) Pause(reason string, abortActive bool) int {
	q.mu.Lock()
	q.paused, q.pauseReason = true, reason
	if abortActive {
		for _, cancel := range q.activeJobs {
			cancel()
		}
	}
	q.mu.Unlock()
	return q.ShedPending(len(q.jobs))
}

func (q *Queue) Resume() {
	q.mu.Lock()
	q.paused, q.pauseReason = false, ""
	q.mu.Unlock()
}

func (q *Queue) ShedPending(count int) int {
	dropped := 0
	for dropped < count {
		select {
		case job := <-q.jobs:
			dropped++
			if job.Drop != nil {
				job.Drop(ErrPaused)
			}
		default:
			return dropped
		}
	}
	return dropped
}

func (q *Queue) Stats() Stats {
	q.mu.RLock()
	defer q.mu.RUnlock()
	return Stats{Active: q.active.Load(), Pending: len(q.jobs), Paused: q.paused, PausedReason: q.pauseReason}
}

func (q *Queue) Close() { q.cancel() }

func (q *Queue) worker() {
	for {
		select {
		case <-q.ctx.Done():
			return
		case job := <-q.jobs:
			q.mu.RLock()
			paused := q.paused
			q.mu.RUnlock()
			if paused {
				if job.Drop != nil {
					job.Drop(ErrPaused)
				}
				continue
			}
			ctx, cancel := context.WithCancel(q.ctx)
			q.mu.Lock()
			q.activeJobs[job.ID] = cancel
			q.mu.Unlock()
			q.active.Add(1)
			_ = job.Run(ctx)
			q.active.Add(-1)
			cancel()
			q.mu.Lock()
			delete(q.activeJobs, job.ID)
			q.mu.Unlock()
		}
	}
}
