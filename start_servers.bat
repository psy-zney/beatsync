@echo off
start "Backend Server" cmd /k "cd /d "%~dp0" && bun turbo run dev --filter=server"
echo Da khoi dong Backend trong cua so rieng biet!
