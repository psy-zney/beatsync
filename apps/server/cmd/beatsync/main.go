package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/app"
	"github.com/psy-zney/beatsync/apps/server/internal/config"
	"github.com/psy-zney/beatsync/apps/server/internal/hybrid"
)

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.LUTC | log.Lmicroseconds)
	envFile := os.Getenv("BEATSYNC_ENV_FILE")
	if envFile == "" {
		envFile = ".env"
	}
	if err := config.LoadEnvFile(envFile); err != nil {
		log.Fatalf("load %s: %v", envFile, err)
	}
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("configuration: %v", err)
	}
	debug.SetMemoryLimit(int64(cfg.MemorySoftLimitBytes))
	rootCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if cfg.WorkerServerURL != "" {
		log.Printf("BeatSync hybrid worker starting: server=%s id=%s", cfg.WorkerServerURL, cfg.WorkerID)
		if err := hybrid.NewAgent(cfg).Run(rootCtx); err != nil {
			log.Fatalf("hybrid worker: %v", err)
		}
		return
	}
	application, err := app.New(cfg)
	if err != nil {
		log.Fatalf("initialize backend: %v", err)
	}

	restoreCtx, cancelRestore := context.WithTimeout(rootCtx, 30*time.Second)
	application.Restore(restoreCtx)
	cancelRestore()
	application.RunBackground(rootCtx)

	server := &http.Server{
		Addr: cfg.Address(), Handler: application.Handler(),
		ReadHeaderTimeout: 10 * time.Second, WriteTimeout: 0,
		IdleTimeout: 90 * time.Second, MaxHeaderBytes: 32 << 10,
	}
	serverErrors := make(chan error, 1)
	go func() {
		log.Printf("BeatSync Go backend listening on http://%s", cfg.Address())
		serverErrors <- server.ListenAndServe()
	}()
	select {
	case <-rootCtx.Done():
	case serveErr := <-serverErrors:
		if !errors.Is(serveErr, http.ErrServerClosed) {
			log.Printf("HTTP server stopped unexpectedly: %v", serveErr)
		}
	}
	stop()
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelShutdown()
	_ = server.Shutdown(shutdownCtx)
	application.Shutdown(shutdownCtx)
	application.Wait()
}
