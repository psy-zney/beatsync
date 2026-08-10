# BeatSync

BeatSync phát nhạc đồng bộ theo thời gian thực giữa nhiều thiết bị, có chat, avatar, voice qua LiveKit, Fly/3D audio, nhập Spotify và tìm nhạc YouTube.

## Kiến trúc

- `apps/client`: Next.js/React, triển khai trên Vercel.
- `apps/server`: một binary Go nhỏ gọn giữ room state, HTTP, WebSocket, queue, backup và S3/R2.
- `apps/server/yt-rust-extractor`: wrapper Rust tối giản quanh `yt-dlp`; chỉ xuất URL stream và title.
- `packages/shared`: schema TypeScript dành cho client. Backend Go giữ tương thích với các message/API này.

Backend không cần Bun/Node, Go compiler hay Rust compiler trên VPS. GitHub Actions build sẵn ba binary (`beatsync-server`, `yt-rust-extractor`, `yt-dlp`) rồi cài bằng systemd và tự rollback nếu `/health` thất bại.

## Chạy local

Frontend:

```bash
bun install
bun client
```

Backend (Go 1.26+ và `yt-dlp` trong PATH nếu dùng YouTube):

```bash
cp apps/server/.env.example apps/server/.env
cd apps/server
go run ./cmd/beatsync
```

Mặc định client chạy ở `http://localhost:3001`, backend ở `http://127.0.0.1:1001`.

## Kiểm tra

```bash
cd apps/server
go test ./...
go build -trimpath -o dist/beatsync-server ./cmd/beatsync
```

```bash
bun run --cwd apps/client typecheck
bun run --cwd apps/client build
```

## Cấu hình và deploy

Xem [`apps/server/.env.example`](apps/server/.env.example) cho toàn bộ biến môi trường và [`OPERATIONS.md`](OPERATIONS.md) cho giới hạn RAM, backup, systemd, rollback và GitHub Actions.

Secret LiveKit/S3/creator chỉ nằm trong `apps/server/.env` trên VPS. Frontend không cần và không được chứa các key này. Spotify credentials là tùy chọn; khi không có, server dùng metadata public embed/oEmbed.
