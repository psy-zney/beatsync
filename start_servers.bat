@echo off
cd /d "%~dp0"
echo Khoi dong client va Go backend local. Mo http://localhost:3001 khi san sang.
echo De offload cho VPS, dung start_worker.bat.
call bun run dev
if errorlevel 1 pause
