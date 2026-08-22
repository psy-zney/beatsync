@echo off
setlocal
set "SERVER_DIR=%~dp0apps\server"
if not exist "%SERVER_DIR%\.env.worker" (
  echo Chua co apps\server\.env.worker.
  echo Hay copy .env.worker.example thanh .env.worker va dien WORKER_SERVER_URL, HYBRID_WORKER_SECRET.
  exit /b 1
)
start "BeatSync Hybrid Worker" cmd /k "cd /d ""%SERVER_DIR%"" && set ""BEATSYNC_ENV_FILE=.env.worker"" && go run ./cmd/beatsync"
echo Da khoi dong hybrid worker. VPS se tu nhan worker sau khi WebSocket duoc xac thuc.
