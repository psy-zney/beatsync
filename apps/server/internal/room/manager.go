package room

import (
	"sort"
	"sync"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
)

type Manager struct {
	mu    sync.RWMutex
	rooms map[string]*Room
}

func NewManager() *Manager { return &Manager{rooms: make(map[string]*Room)} }
func (m *Manager) Get(id string) (*Room, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	room, ok := m.rooms[id]
	return room, ok
}
func (m *Manager) GetOrCreate(id string) *Room {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r := m.rooms[id]; r != nil {
		return r
	}
	r := New(id)
	m.rooms[id] = r
	return r
}
func (m *Manager) Delete(id string) { m.mu.Lock(); delete(m.rooms, id); m.mu.Unlock() }
func (m *Manager) Rooms() []*Room {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]*Room, 0, len(m.rooms))
	for _, r := range m.rooms {
		result = append(result, r)
	}
	return result
}
func (m *Manager) Count() int { m.mu.RLock(); defer m.mu.RUnlock(); return len(m.rooms) }
func (m *Manager) ActiveUsers() int {
	total := 0
	for _, r := range m.Rooms() {
		total += r.ConnectionCount()
	}
	return total
}
func (m *Manager) Discover() []map[string]any {
	rooms := m.Rooms()
	sort.Slice(rooms, func(i, j int) bool { return rooms[i].ConnectionCount() > rooms[j].ConnectionCount() })
	if len(rooms) > 50 {
		rooms = rooms[:50]
	}
	result := make([]map[string]any, 0, len(rooms))
	for _, r := range rooms {
		if r.ConnectionCount() > 0 {
			result = append(result, r.Discovery())
		}
	}
	return result
}
func (m *Manager) Snapshot() model.ServerBackup {
	backup := model.ServerBackup{Timestamp: float64(time.Now().UnixNano()) / 1e6}
	backup.Data.Rooms = make(map[string]model.RoomBackup)
	for _, r := range m.Rooms() {
		backup.Data.Rooms[r.ID] = r.Snapshot()
	}
	return backup
}
func (m *Manager) Restore(backup model.ServerBackup) {
	for id, data := range backup.Data.Rooms {
		r := m.GetOrCreate(id)
		r.Restore(data)
	}
}
func (m *Manager) CleanupIdle(ttl time.Duration, cleanup func(*Room)) int {
	cutoff := time.Now().Add(-ttl)
	removed := 0
	for _, r := range m.Rooms() {
		if r.IsIdleBefore(cutoff) {
			cleanup(r)
			m.Delete(r.ID)
			removed++
		}
	}
	return removed
}
