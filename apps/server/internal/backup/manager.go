package backup

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/model"
	"github.com/psy-zney/beatsync/apps/server/internal/room"
	"github.com/psy-zney/beatsync/apps/server/internal/storage"
)

const prefix = "state-backup/"

type Manager struct {
	rooms     *room.Manager
	store     *storage.Client
	localPath string
	mu        sync.Mutex
}

func New(rooms *room.Manager, store *storage.Client, localPath string) *Manager {
	return &Manager{rooms: rooms, store: store, localPath: localPath}
}

func (m *Manager) SaveLocal() error {
	data, err := json.Marshal(m.rooms.Snapshot())
	if err != nil {
		return err
	}
	directory := filepath.Dir(m.localPath)
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, ".state-backup-*.tmp")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err = temporary.Chmod(0o600); err == nil {
		_, err = temporary.Write(data)
	}
	if err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(name, m.localPath)
}

func (m *Manager) Save(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.SaveLocal(); err != nil {
		return fmt.Errorf("local backup: %w", err)
	}
	if m.store == nil {
		return nil
	}
	snapshot := m.rooms.Snapshot()
	key := prefix + "backup-" + time.Now().UTC().Format("2006-01-02_15-04-05") + ".json"
	if err := m.store.PutJSON(ctx, key, snapshot); err != nil {
		return fmt.Errorf("remote backup: %w", err)
	}
	if err := m.cleanup(ctx, 5); err != nil {
		log.Printf("backup retention cleanup failed: %v", err)
	}
	return nil
}

func (m *Manager) Restore(ctx context.Context) (bool, error) {
	local, localErr := m.readLocal()
	var remote *model.ServerBackup
	if m.store != nil {
		objects, err := m.store.List(ctx, prefix)
		if err == nil {
			for index := len(objects) - 1; index >= 0; index-- {
				if filepath.Ext(objects[index].Key) != ".json" {
					continue
				}
				var candidate model.ServerBackup
				if err := m.store.GetJSON(ctx, objects[index].Key, 16<<20, &candidate); err == nil && valid(candidate) {
					remote = &candidate
					break
				}
			}
		} else if localErr != nil {
			return false, fmt.Errorf("remote restore: %w", err)
		}
	}
	chosen := local
	if remote != nil && (chosen == nil || remote.Timestamp > chosen.Timestamp) {
		chosen = remote
	}
	if chosen == nil {
		if localErr != nil && !errors.Is(localErr, os.ErrNotExist) {
			return false, localErr
		}
		return false, nil
	}
	m.rooms.Restore(*chosen)
	return true, nil
}

func (m *Manager) readLocal() (*model.ServerBackup, error) {
	file, err := os.Open(m.localPath)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var snapshot model.ServerBackup
	decoder := json.NewDecoder(file)
	if err := decoder.Decode(&snapshot); err != nil {
		return nil, err
	}
	if !valid(snapshot) {
		return nil, errors.New("invalid local backup")
	}
	return &snapshot, nil
}

func (m *Manager) cleanup(ctx context.Context, keep int) error {
	objects, err := m.store.List(ctx, prefix)
	if err != nil {
		return err
	}
	filtered := objects[:0]
	for _, object := range objects {
		if filepath.Ext(object.Key) == ".json" {
			filtered = append(filtered, object)
		}
	}
	sort.Slice(filtered, func(i, j int) bool { return filtered[i].Key > filtered[j].Key })
	for _, object := range filtered[min(keep, len(filtered)):] {
		if err := m.store.Delete(ctx, object.Key); err != nil {
			return err
		}
	}
	return nil
}

func valid(value model.ServerBackup) bool { return value.Timestamp > 0 && value.Data.Rooms != nil }
