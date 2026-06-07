@echo off
start "MinIO Server" cmd /k "cd C:\minio && set MINIO_ROOT_USER=admin&& set MINIO_ROOT_PASSWORD=password123&& .\minio.exe server C:\minio\data --console-address :9001"
start "Backend Server" cmd /k "cd C:\Users\Admin\MyProject\beatsync && bun turbo run dev --filter=server"
start "LocalTunnel" cmd /k "npx localtunnel --port 8080 --subdomain beatsync-dev"
echo Da khoi dong MinIO, Server va LocalTunnel trong cac cua so rieng biet!

