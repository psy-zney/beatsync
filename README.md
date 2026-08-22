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

## Hybrid worker: VPS ổn định, máy local xử lý việc nặng

Không chuyển CNAME qua lại giữa VPS và máy local. Hostname backend public vẫn
trỏ duy nhất tới Cloudflare Tunnel trên VPS; máy local chỉ tạo một kết nối
WebSocket outbound đã xác thực tới VPS:

```text
User ──HTTPS/WSS──> Cloudflare Tunnel ──> VPS Go backend
                                             │
                                             ├─ room/WebSocket/NTP/chat/R2 state
                                             │
Local worker ──outbound WSS + heartbeat──────┘
       └─ Spotify resolve, YouTube search/metadata/extract
```

Cách tách này giữ room state và kết nối nhẹ ở một nơi. Broker chỉ giao job khi
worker còn online và còn slot. Mỗi job có lease; nếu local tắt, mất mạng hoặc
quá deadline, job đang thuê được trả lỗi ngay cho caller và chạy lại trên VPS.
Các stream job chưa bắt đầu vẫn nằm trong queue RAM của VPS. Khi local vừa bật,
job mới và job đang chờ sẽ ưu tiên local; job nặng đã chạy trên VPS không bị
preempt giữa chừng. Playlist/audio đã hoàn tất tiếp tục nằm trên R2.

### 1. Giữ DNS/Tunnel ở VPS

Trong Cloudflare DNS, CNAME của backend phải tiếp tục trỏ tới
`<UUID-VPS>.cfargotunnel.com`. Không cần Tunnel hay CNAME cho máy local. Theo
[Cloudflare Tunnel routing](https://developers.cloudflare.com/tunnel/routing/),
DNS record ánh xạ hostname vào một tunnel; WebSocket được Cloudflare proxy hỗ
trợ theo [tài liệu WebSockets](https://developers.cloudflare.com/network/websockets/).

### 2. Bật broker trên VPS

Tạo secret ngẫu nhiên tối thiểu 32 byte, thêm vào
`apps/server/.env` trên VPS rồi restart service:

```bash
openssl rand -base64 48
```

```dotenv
HYBRID_WORKER_SECRET=<cùng-một-secret-với-local>
HYBRID_JOB_LEASE=20s
```

```bash
sudo systemctl restart beatsync.service
curl -fsS http://127.0.0.1:3001/health
```

Khi chưa có local, health trả `hybridWorker.workers: 0`; backend vẫn xử lý toàn
bộ job trên VPS như trước. Không đưa secret này vào Git hoặc frontend.

### 3. Bật worker trên máy local

```powershell
Copy-Item apps/server/.env.worker.example apps/server/.env.worker
```

Điền cấu hình sau; URL là hostname backend hiện đang đi vào Tunnel/VPS:

```dotenv
WORKER_SERVER_URL=https://backend.example.com
HYBRID_WORKER_SECRET=<cùng-secret-trên-VPS>
WORKER_ID=local-primary
WORKER_CONCURRENCY=2
```

Đặt đường dẫn `YT_EXTRACTOR_PATH`, `YTDLP_PATH` trong `.env.worker` nếu các file
không nằm cạnh binary/không có trong `PATH`, sau đó chạy `start_worker.bat`.
Cùng binary `cmd/beatsync` tự chuyển sang worker mode khi có
`WORKER_SERVER_URL`; nó không mở cổng public trên máy local.

`WORKER_CONCURRENCY=2` là mức khởi đầu hợp lý: local nhận tối đa hai job nặng,
job vượt capacity lập tức fallback VPS thay vì xếp hàng vô hạn. Có thể quan sát
`workers`, `capacity`, `inflight` và `pendingOnVps` trong `/health` hoặc `/stats`.

### 4. Lớp bảo vệ Cloudflare Access tùy chọn

Có thể tạo Access application chỉ cho đường dẫn `/internal/worker*`, policy
Service Auth và service token cho máy local. Điền cặp token vào
`CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET`; worker sẽ gửi hai header trong
WebSocket handshake. Cloudflare mô tả quy trình tạo và thu hồi token tại
[Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).
Origin vẫn kiểm tra `HYBRID_WORKER_SECRET`, nên đây là hai lớp xác thực độc lập.

Không áp policy Access của worker lên toàn hostname nếu frontend/user hiện cần
truy cập public, vì như vậy có thể chặn cả `/ws`, `/spotify/resolve` và health.

<!-- AUTO-GENERATED: go-vs-bun-benchmark:start -->

## Đánh giá chuyển đổi backend từ Bun sang Go

> Benchmark ngày 2026-08-22 giữa `backup/bun-backend` (`a282e6b`) và
> `migration/go-backend` (`0987e39`). Kết luận: **Go là hướng chuyển đổi phù
> hợp cho VPS yếu, đặc biệt khi RAM/OOM là nút thắt; nhánh Go chưa nên phát
> hành nguyên trạng cho đến khi sửa WebSocket burst và hoàn tất API parity.**

### Phương pháp

- Chạy hai backend trên cùng máy Windows x64, i5-12450HX, Bun 1.3.14 và Go 1.26.5.
- Mỗi lượt dùng process mới, chạy xen kẽ Bun/Go và loại warm-up khỏi kết quả.
- Năm lượt dùng toàn CPU; ba lượt ép server còn một core để làm proxy cho VPS một vCPU.
- HTTP dùng `GET /health` ở concurrency 1 và 32.
- WebSocket dùng 200 client với cả hai kịch bản: kết nối đồng thời và ramp đều trong 5 giây.
- Số liệu dưới đây là median; báo cáo đầy đủ còn lưu MAD, min/max và raw measurements.

Đây là benchmark của chính BeatSync tại hai commit trên, không phải kết luận
chung rằng Go luôn nhanh hơn Bun. Môi trường đo không thay thế phép thử cuối
cùng trên VPS Linux thật.

### Footprint và khả năng vận hành trên VPS yếu

| Chỉ số | Bun | Go | Chênh lệch của Go |
| --- | ---: | ---: | ---: |
| Startup process | 175,61 ms | 22,00 ms | **-87,5%**, nhanh hơn khoảng 8× |
| RSS idle | 91,17 MiB | 9,79 MiB | **-89,3%** |
| RSS với 200 WebSocket sống | 91,43 MiB | 24,26 MiB | **-73,5%** |
| Artifact tự chứa | 96,04 MiB | 7,61 MiB | **-92,1%**, nhỏ hơn khoảng 12,6× |
| Production source | 5.713 dòng | 3.809 dòng | **-33,3%** |
| Direct production dependencies | 14 | 1 | Bề mặt dependency nhỏ hơn |

Với 200 WebSocket sống, process Go dùng ít hơn khoảng 67 MiB. Nếu chỉ quy đổi
RSS process theo ngân sách 256 MiB, workload này chiếm khoảng 9,5% ở Go và
35,7% ở Bun. Phép quy đổi chưa bao gồm OS, reverse proxy, extractor, `yt-dlp`,
audio cache hoặc các service khác.

Go tăng khoảng 14,42 MiB khi thêm 200 socket, trong khi Bun chỉ tăng khoảng
1,19 MiB do phần lớn chi phí đã nằm trong runtime base. Vì vậy không được
ngoại suy tuyến tính lên hàng nghìn client; cần benchmark riêng ở
500/1.000/2.000 client trên Linux.

### HTTP trên proxy một vCPU

| Chỉ số | Bun | Go | Chênh lệch của Go |
| --- | ---: | ---: | ---: |
| Throughput, concurrency 1 | 10.731 req/s | 11.998 req/s | **+11,8%** |
| p99, concurrency 1 | 0,898 ms | 0,527 ms | **-41,3%** |
| Throughput, concurrency 32 | 41.953 req/s | 39.463 req/s | -5,9% |
| p95, concurrency 32 | 1,594 ms | 1,848 ms | +15,9% |
| p99, concurrency 32 | 3,031 ms | 3,393 ms | +11,9% |
| Request/CPU-second, concurrency 32 | 51.307 | 50.334 | -1,9% |

Khi bị giới hạn một core, hiệu quả CPU giữa hai bản gần tương đương. Go đổi
một lượng tail latency nhỏ ở tải concurrent lấy mức RAM thấp hơn rất lớn. Đây
là trade-off thuận lợi cho VPS yếu nếu RAM/OOM là vấn đề chính. Tất cả HTTP
workload ở cả hai backend có tổng lỗi bằng 0.

Khi được dùng toàn bộ 12 logical CPU, Go đạt throughput concurrency 32 cao hơn
18,8% nhưng dùng khoảng 4,25× CPU time và có request/CPU-second thấp hơn 72,1%.
Do đó lập luận đúng cho migration là **giảm mạnh RAM và footprint trong khi
hiệu suất một vCPU gần tương đương**, không phải “Go luôn nhanh hơn Bun”.

### WebSocket

Kịch bản ramp 200 client trong 5 giây đạt kết quả ổn định ở cả ba lượt:

| Chỉ số | Bun | Go |
| --- | ---: | ---: |
| Handshake mở | 200/200 | 200/200 |
| Socket còn sống sau 1 giây | 200/200 | 200/200 |
| NTP probe thành công | 200/200 | 200/200 |
| NTP RTT p50 | 2,592 ms | 2,040 ms |

Kịch bản burst 200 kết nối đồng thời phát hiện một blocker:

- Bun trả lời 5.000/5.000 NTP probe qua năm lượt.
- Go mở handshake nhưng trả lời 0/5.000 NTP probe qua năm lượt toàn CPU.
- Queue gửi Go chỉ có 8 phần tử và đóng socket khi queue đầy. Nhiều state
  message cộng broadcast user count khi client cùng vào tạo ra burst vượt quá
  tốc độ writer drain.

Đây là lỗi backpressure/broadcast, không phải lỗi protocol NTP: cùng code Go
đạt 100% khi client được ramp trong 5 giây. VPS yếu còn nhạy hơn với lỗi này
do writer drain chậm hơn.

> Trạng thái sau benchmark: working tree hiện tại đã tăng queue có giới hạn từ
> 8 lên 64, vẫn fail-closed khi client chậm kéo dài, và có integration test gửi
> burst 40 message rồi xác nhận NTP tiếp tục hoạt động. Đây là remediation có
> regression coverage, chưa thay thế gate chạy lại 200/500 client trên VPS.

Trước khi deploy cần:

1. Coalesce state có tính “latest wins”, đặc biệt user count.
2. Không đóng socket ngay vì burst ngắn của message không quan trọng.
3. Tăng queue có giới hạn sau khi đo memory; không dùng queue vô hạn.
4. Thêm metric queue-full, forced-close, queue depth và dropped/coalesced message.
5. Đưa cả burst test và ramp test vào CI.

### Correctness và API parity

- Bun đạt 112/114 test; hai test lỗi liên quan việc lọc active rooms.
- Go đạt 14/14 test, nhưng chỉ có 323 dòng test so với 2.131 dòng test Bun.
- Cả hai smoke test thành công cho health, stats, active/discover/default,
  voice-unconfigured, upload-disabled và WebSocket/NTP cơ bản.
- Bun trả error body dạng plain text; Go trả JSON `{ "error": ... }`.
- CORS preflight đổi từ HTTP 200 sang 204.
- `/stats` Go chưa có storage totals, orphaned rooms và file size/count như Bun.
- Schema memory và thứ tự một số WebSocket initialization message đã thay đổi.

Không nên dùng tỷ lệ test pass để nói Go đúng hơn: suite Go còn nhỏ. Cần port
các regression test về room lifecycle, backup/restore, stale client, audio
coordination và WebSocket close/message trước khi bỏ backend Bun.

Sau benchmark, suite Go đã tăng từ 14 lên 40 hàm test, bổ sung room cleanup,
audio loading/disconnect/timeout, backup nhiều room và dữ liệu lỗi, Hub
replacement/backpressure, WebSocket burst, cùng broker hybrid auth/capacity/
disconnect failover. Con số lịch sử 14/14 phía trên vẫn được giữ để báo cáo
đúng trạng thái của commit đã benchmark.

### Kết luận và release gates

Hướng chuyển Go được dữ liệu ủng hộ cho VPS thiếu RAM: RSS idle giảm khoảng
89%, RSS ở 200 WebSocket giảm khoảng 73,5%, startup nhanh hơn khoảng 8× và
artifact nhỏ hơn khoảng 12,6×, trong khi hiệu suất một vCPU chỉ dao động từ
`+11,8%` đến `-5,9%` tùy mức concurrency.

Chỉ chuyển traffic production sau khi đạt đủ các gate:

1. Burst 200 và ramp 500 đạt 100% socket survival, error dưới 0,1%.
2. Giữ backward compatibility cho error body/schema hoặc version client và API đồng thời.
3. Phục hồi các trường `/stats` cần cho vận hành và cảnh báo memory pressure.
4. Mở rộng test suite Go tới các hành vi quan trọng của suite Bun.
5. Chạy lại trên VPS thật với cgroup 1 vCPU/512 MiB và soak test 30–60 phút.
6. Canary 5% traffic, theo dõi RSS, CPU throttling, GC, reconnect, NTP p95/p99,
   queue-full và forced-close; luôn giữ rollback về Bun.

Báo cáo và dữ liệu nguồn:

- [Báo cáo đầy đủ](.ecc/benchmarks/go-vs-bun/REPORT.vi.md)
- [Bảng tổng hợp median/MAD](.ecc/benchmarks/go-vs-bun/summary.json)
- [Raw runtime measurements](.ecc/benchmarks/go-vs-bun/raw-windows.json)
- [Raw WebSocket ramp](.ecc/benchmarks/go-vs-bun/raw-ws-ramp.json)
- [API parity smoke test](.ecc/benchmarks/go-vs-bun/parity-smoke.json)

<!-- AUTO-GENERATED: go-vs-bun-benchmark:end -->

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
