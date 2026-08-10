# BeatSync

BeatSync là ứng dụng nghe nhạc đồng bộ theo thời gian thực giữa nhiều thiết bị. Một phòng có thể cùng phát nhạc, quản lý hàng chờ, chat, dùng avatar, voice chat và hiệu ứng Fly/3D Audio.

## Tính năng chính

- Đồng bộ play, pause, chuyển bài và vị trí phát qua WebSocket.
- Hàng chờ dùng chung, tìm kiếm YouTube và nhập playlist Spotify.
- Chat, avatar, vị trí người nghe và voice chat qua LiveKit.
- Fly/3D Audio với chuyển âm trái/phải và điều chỉnh thủ công.
- Upload nhạc theo luồng lên S3/R2, không giữ toàn bộ file trong RAM.
- Backend tự giới hạn hàng chờ, giảm tải khi thiếu RAM và khôi phục state từ backup.
- Spotify API key là tùy chọn; khi không có key, backend dùng metadata public.

## Kiến trúc

| Thành phần                      | Công nghệ                       | Vai trò                                               |
| ------------------------------- | ------------------------------- | ----------------------------------------------------- |
| `apps/client`                   | Next.js 16, React 19, Web Audio | Giao diện, player, chat, voice và 3D audio            |
| `apps/server`                   | Go                              | HTTP, WebSocket, room state, queue, backup và S3/R2   |
| `apps/server/yt-rust-extractor` | Rust + yt-dlp                   | Lấy URL audio YouTube với output và RAM được giới hạn |
| `packages/shared`               | TypeScript + Zod                | Schema và kiểu dữ liệu dùng bởi client                |

Production giữ backend trong một process để room/WebSocket state không bị chia cắt. GitHub Actions build sẵn Go, Rust và yt-dlp; VPS không cần cài Node, Bun, Go hay Rust.

## Yêu cầu phát triển

- [Bun](https://bun.sh/) 1.3.8+
- [Go](https://go.dev/) 1.26+
- Rust 1.90+ nếu cần sửa hoặc build extractor
- `yt-dlp` trong `PATH` nếu kiểm tra luồng YouTube ngoài Docker
- Docker Compose v2 nếu chạy backend bằng container

Các phiên bản khuyến nghị cũng được khai báo trong `mise.toml`.

## Chạy local

Tạo file cấu hình:

```powershell
Copy-Item apps/server/.env.example apps/server/.env
Copy-Item apps/client/.env.example apps/client/.env.local
```

Trên macOS/Linux dùng `cp` thay cho `Copy-Item`. Sau đó cài dependency và chạy cả client lẫn server:

```bash
bun install
bun dev
```

- Client: `http://localhost:3001`
- Backend: `http://127.0.0.1:1001`
- Health check: `http://127.0.0.1:1001/health`

Có thể chạy riêng từng phần:

```bash
bun client
bun server
```

## Chạy backend bằng Docker

Docker image chỉ chứa runtime backend: binary Go, Rust extractor và bản `yt-dlp_musllinux` đã kiểm tra SHA-256. Container chạy non-root, filesystem chỉ đọc, RAM tối đa 420 MiB và state được giữ trong volume `beatsync-data`. File tạm dùng volume `beatsync-tmp` trên đĩa thay vì `tmpfs`, tránh lấy RAM của VPS khi tải nhạc.

```bash
cp apps/server/.env.example apps/server/.env
docker compose up --build -d
docker compose ps
docker compose logs -f server
```

Hoặc dùng script Bun tương ứng:

```bash
bun run docker:up
bun run docker:logs
bun run docker:down
```

Mặc định host mở cổng `1001`. Có thể đổi cổng phía máy chủ mà không đổi cổng trong container:

```bash
BEATSYNC_PORT=8080 docker compose up --build -d
```

Phiên bản yt-dlp mặc định được pin trong `Dockerfile` để build có thể tái lập. Khi cần nâng phiên bản:

```bash
docker build --build-arg YTDLP_VERSION=YYYY.MM.DD -t beatsync-server:local .
```

## Kiểm tra trước khi đưa lên main

```bash
cd apps/server
go test ./...
go vet ./...
go build -trimpath -o dist/beatsync-server ./cmd/beatsync
```

```bash
cargo fmt --all --manifest-path apps/server/yt-rust-extractor/Cargo.toml -- --check
cargo clippy --locked --manifest-path apps/server/yt-rust-extractor/Cargo.toml --all-targets -- -D warnings
```

```bash
bun run --cwd apps/client typecheck
bun run --cwd apps/client test
bun run --cwd apps/client build
```

```bash
cp apps/server/.env.example apps/server/.env
docker compose config --quiet
docker build --tag beatsync-server:ci .
```

## Cấu hình và bảo mật

Danh sách biến backend nằm trong `apps/server/.env.example`; biến public của frontend nằm trong `apps/client/.env.example`.

- Không commit `.env`, private key SSH, LiveKit secret hoặc S3/R2 secret.
- Frontend chỉ được chứa biến có tiền tố `NEXT_PUBLIC_` và không được nhận backend secret.
- `SPOTIFY_CLIENT_ID` và `SPOTIFY_CLIENT_SECRET` không bắt buộc.
- Dữ liệu backup local của Docker nằm trong volume; production VPS lưu tại `/opt/beatsync/data`.

## Deploy

Mỗi push lên `main` kích hoạt `.github/workflows/deploy.yml`:

1. test và build Go/Rust trên GitHub runner;
2. tải yt-dlp và xác minh checksum chính thức;
3. gửi bundle qua SSH đã pin host fingerprint;
4. cài release mới, restart systemd và gọi `/health`;
5. tự rollback nếu health check thất bại;
6. chỉ giữ release hiện tại và một bản rollback để tiết kiệm ổ đĩa VPS.

Frontend được deploy riêng qua Vercel. Hướng dẫn giới hạn RAM, swap, backup, systemd và xử lý sự cố nằm trong [`OPERATIONS.md`](OPERATIONS.md).

## Cấu trúc repo

```text
beatsync/
├── apps/
│   ├── client/                 # Next.js frontend
│   ├── server/                 # Go backend
│   │   ├── cmd/beatsync/       # entrypoint
│   │   ├── internal/           # application core
│   │   └── yt-rust-extractor/  # helper gọi yt-dlp
│   └── storage/                # cấu hình CORS cho object storage
├── packages/shared/            # schema TypeScript phía client
├── scripts/                    # cài đặt và giới hạn tài nguyên VPS
├── compose.yml
└── Dockerfile
```

## Giấy phép

Dự án sử dụng giấy phép [MIT](LICENSE).
