@echo off
start "Backend Server" cmd /k "cd /d ""%~dp0apps\server"" && go run ./cmd/beatsync"
echo Da khoi dong Go backend trong cua so rieng biet!
