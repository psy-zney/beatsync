# BeatSync

BeatSync is a real-time synchronized music playback application across multiple devices. A room can play music together, manage a shared queue, chat, use avatars, voice chat, and Fly/3D Spatial Audio effects.

## Key Features

- Synchronized play, pause, seek, and track transitions via WebSocket.
- Shared room queue, YouTube search, and Spotify playlist import.
- Create multiple rooms with 6-digit codes, suggest recent rooms, and save personal playlists in the browser.
- Chat, avatar, listener positioning, and voice chat via LiveKit.
- Fly/3D Spatial Audio with left/right transitions and manual controls.
- Streaming audio uploads to S3/R2 without buffering whole files in RAM.
- Self-limiting queue on the backend, shedding load under memory pressure and recovering state from backups.
- Spotify API keys are optional; without credentials, public metadata resolution is used.

## Lyrics

Lyrics are automatically resolved on the backend when adding tracks, restoring playlists, or playing music; no modal search required. The system prepares the currently playing track and the next two tracks, prioritizing original creator subtitles on YouTube, followed by [LRCLIB](https://lrclib.net/docs) when track, artist, and duration match. YouTube auto-generated speech recognition subtitles are excluded from automatic resolution due to inaccuracies. Original lyrics are used without auto-selecting machine-translated subtitles.

Click **Lyrics** below the player. Lyrics auto-scroll, highlight the active line, and support word-by-word highlighting when source timestamps are available; click any line to seek. Instrumental sections are displayed cleanly. Plain lyrics remain readable statically when timestamps are not provided. Each lyric payload is capped at 40 KB.

Network errors retry automatically with backoff; a **Retry lyrics** button is available. **Edit lyrics** allows picking an alternate version or pasting custom `.lrc` text like `[00:12.50]Lyric line`. Hand-edited lyrics are preserved by the backend. If metadata confidence is insufficient, lyrics remain unset to prevent mismatched songs.

Lyrics are shared with everyone in the room, including listeners joining later. The **− / +** buttons adjust lyrics timing earlier or later by 0.1 seconds; click the offset indicator to reset. **Save** in the player preserves selected lyrics alongside the playlist. Background audio remains the currently playing track.

Production defaults to a single lyric resolver worker (`LYRICS_MAX_CONCURRENCY=1`, configurable 1–4). Results are cached by video ID up to 512 entries in `lyrics-cache` next to backup files; transient network failures are not cached. `/health` includes a `lyrics` section for monitoring. When a hybrid worker is active, `youtube.lyrics` jobs offload to the worker with automatic fallback if unavailable.

## Rooms and saved playlists

The home page lets listeners enter a room code or create a new room. The name and avatar sit in a compact row above the room code; avatar options open on demand. The browser suggests the six most recent rooms that were joined successfully.

In regular rooms, **Save** stores track titles and references in the current browser's `localStorage`. Compact text records replace YouTube cache links with video IDs. The library supports up to 20 playlists, 500 tracks per playlist, and 1 MB in total. A full library asks the listener to delete an old playlist rather than overwrite another list. Long playlists use local storage because cookies have a small capacity and travel with requests.

Creating a new room with saved playlists in the browser prompts the listener to reuse a list. Joining an existing room opens the import dialog only through **Import**. The dialog supports selecting saved playlists and individual tracks or importing from Spotify; importing adds tracks to the current queue.

**Exception: room `090624` continues saving and restoring its playlist through R2**, including automatic saving when an idle room is released. Other rooms do not read or write `room-<code>/playlist.json` in R2.

The browser library contains track metadata. Uploads, audio caches, and operational backups still use S3/R2; this change does not impose a storage limit on those files. Deleted uploads must be uploaded again. Clearing browser data removes locally saved playlists and room history.

## Architecture

| Component                       | Technology                      | Role                                                  |
| ------------------------------- | ------------------------------- | ----------------------------------------------------- |
| `apps/client`                   | Next.js 16, React 19, Web Audio | User interface, player, chat, voice, and 3D audio     |
| `apps/server`                   | Go                              | HTTP, WebSocket, room state, queue, backup, and S3/R2 |
| `apps/server/yt-rust-extractor` | Rust + yt-dlp                   | YouTube audio extraction with bounded RAM and output  |
| `packages/shared`               | TypeScript + Zod                | Schemas and data types shared with client             |

Production keeps the backend in a single process to prevent partitioned room/WebSocket state. GitHub Actions pre-builds Go, Rust, and yt-dlp; the host VPS does not need Node, Bun, Go, or Rust installed.

## Development Requirements

- [Bun](https://bun.sh/) 1.3.8+
- [Go](https://go.dev/) 1.26+
- Rust 1.90+ if modifying or building the extractor
- `yt-dlp` in `PATH` if testing YouTube extraction outside Docker
- Docker Compose v2 if running backend in a container

Recommended tool versions are defined in `mise.toml`.

## Running Locally

Create configuration files:

```powershell
Copy-Item apps/server/.env.example apps/server/.env
Copy-Item apps/client/.env.example apps/client/.env.local
```

On macOS/Linux use `cp` instead of `Copy-Item`. Then install dependencies and run both client and server:

```bash
bun install
bun dev
```

`bun dev` launches both frontend and backend. The backend automatically locates Go in `PATH` or uses `local/tooling/go/bin`; no manual PATH modifications required. On Windows, `start_servers.bat` can be used. Local backend binaries build to `apps/server/dist` to avoid Windows temporary directory execution blocks.

- Client: `http://localhost:3001`
- Backend: `http://127.0.0.1:1001`
- Health check: `http://127.0.0.1:1001/health`

Individual components can also be run independently:

```bash
bun client
bun server
```

## Running Backend with Docker

The Docker image contains only the backend runtime: Go binary, Rust extractor, and SHA-256 verified `yt-dlp_musllinux`. The container runs as non-root, read-only root filesystem, 420 MiB RAM limit, and state persisted in volume `beatsync-data`. Temporary files use disk-backed `beatsync-tmp` volume instead of `tmpfs` to avoid consuming VPS RAM during downloads.

```bash
cp apps/server/.env.example apps/server/.env
docker compose up --build -d
docker compose ps
docker compose logs -f server
```

Or using Bun scripts:

```bash
bun run docker:up
bun run docker:logs
bun run docker:down
```

By default the host exposes port `1001`. The host port can be adjusted without changing the container port:

```bash
BEATSYNC_PORT=8080 docker compose up --build -d
```

The yt-dlp version is pinned in the `Dockerfile` for reproducible builds. To upgrade:

```bash
docker build --build-arg YTDLP_VERSION=YYYY.MM.DD -t beatsync-server:local .
```

## Pre-merge Verification

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

## Configuration & Security

Backend environment variables are listed in `apps/server/.env.example`; frontend public variables in `apps/client/.env.example`.

- Never commit `.env`, SSH private keys, LiveKit secrets, or S3/R2 credentials.
- Frontend must only contain variables prefixed with `NEXT_PUBLIC_` and never receive backend secrets.
- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` are optional.
- Docker local backup data resides in a named volume; production VPS stores backups at `/opt/beatsync/data`.

## Deployment

Every push to `main` triggers `.github/workflows/deploy.yml`:

1. Tests and builds Go/Rust on GitHub runners;
2. Downloads yt-dlp and verifies official checksums;
3. Transfers bundle over SSH with pinned host fingerprint;
4. Deploys release, restarts systemd service, and queries `/health`;
5. Automatically rolls back if health check fails;
6. Keeps only current release and one rollback copy to conserve VPS disk space.

Frontend deploys separately via Vercel. Guidance for memory limits, swap, backup, systemd, and troubleshooting is documented in [`OPERATIONS.md`](OPERATIONS.md).

## Hybrid Worker: Stable VPS, Heavy Jobs Offloaded to Local Machine

Never flip DNS CNAME back and forth between VPS and local machines. The public backend hostname always points exclusively to Cloudflare Tunnel on the VPS; the local machine only establishes an authenticated outbound WebSocket connection to the VPS:

```text
User ──HTTPS/WSS──> Cloudflare Tunnel ──> VPS Go backend
                                             │
                                             ├─ room/WebSocket/NTP/chat/R2 state
                                             │
Local worker ──outbound WSS + heartbeat──────┘
       └─ Spotify resolve, YouTube search/metadata/extract
```

This separation keeps room state and lightweight connections centralized. The broker only assigns jobs when a worker is online and has available capacity. Each job has a lease; if the local worker disconnects, loses network, or exceeds its deadline, the leased job immediately returns an error to caller and retries on the VPS. Unstarted stream jobs stay in the VPS RAM queue. When the local worker connects, new and pending jobs favor local execution; heavy jobs already running on the VPS are not preempted midway. Completed audio and playlists remain on R2.

### 1. Maintain DNS/Tunnel on VPS

In Cloudflare DNS, the backend CNAME must point to `<UUID-VPS>.cfargotunnel.com`. No Tunnel or CNAME is needed for the local machine. Under [Cloudflare Tunnel routing](https://developers.cloudflare.com/tunnel/routing/), DNS records map the hostname to a tunnel; WebSockets are proxied by Cloudflare per [WebSockets documentation](https://developers.cloudflare.com/network/websockets/).

### 2. Enable Broker on VPS

Generate a random secret of at least 32 bytes, add it to `apps/server/.env` on the VPS, and restart the service:

```bash
openssl rand -base64 48
```

```dotenv
HYBRID_WORKER_SECRET=<same-secret-as-local>
HYBRID_JOB_LEASE=20s
```

```bash
sudo systemctl restart beatsync.service
curl -fsS http://127.0.0.1:3001/health
```

Without a connected worker, health returns `hybridWorker.workers: 0`; the backend handles all jobs on the VPS as before. Never expose this secret in Git or frontend bundles.

### 3. Launch Worker on Local Machine

```powershell
Copy-Item apps/server/.env.worker.example apps/server/.env.worker
```

Configure with the public backend hostname routed to the Tunnel/VPS:

```dotenv
WORKER_SERVER_URL=https://backend.example.com
HYBRID_WORKER_SECRET=<same-secret-as-VPS>
WORKER_ID=local-primary
WORKER_CONCURRENCY=2
```

Configure `YT_EXTRACTOR_PATH` and `YTDLP_PATH` in `.env.worker` if binaries are not adjacent or not in `PATH`, then run `start_worker.bat`. The same `cmd/beatsync` binary automatically switches to worker mode when `WORKER_SERVER_URL` is set; it does not expose any local public ports.

`WORKER_CONCURRENCY=2` is a safe starting point: the local worker accepts up to two heavy jobs, and jobs exceeding capacity immediately fall back to the VPS rather than queueing indefinitely. Monitor `workers`, `capacity`, `inflight`, and `pendingOnVps` via `/health` or `/stats`.

### 4. Optional Cloudflare Access Layer

You can configure a Cloudflare Access application scoped strictly to `/internal/worker*`, using Service Auth policy and a service token for the local machine. Supply the token credentials in `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`; the worker includes these headers during the WebSocket handshake. See [Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/). The origin still verifies `HYBRID_WORKER_SECRET` as an independent authentication layer.

Do not apply worker Access policies across the entire hostname if public users need access to `/ws`, `/spotify/resolve`, and health endpoints.

<!-- AUTO-GENERATED: go-vs-bun-benchmark:start -->

## Backend Migration Assessment: Bun to Go

> Benchmark dated 2026-08-22 comparing `backup/bun-backend` (`a282e6b`) and
> `migration/go-backend` (`0987e39`). Conclusion: **Go is the right direction
> for memory-constrained VPS deployments, especially where RAM/OOM is the primary
> bottleneck; the Go branch required resolving WebSocket burst handling and API parity before deployment.**

### Methodology

- Both backends evaluated on the same Windows x64 machine, i5-12450HX, Bun 1.3.14 and Go 1.26.5.
- Fresh process per run, alternating Bun/Go with warm-up excluded from measurements.
- 5 runs using all CPUs; 3 runs pinning the server to 1 core as a proxy for 1-vCPU VPS environments.
- HTTP measured with `GET /health` at concurrency 1 and 32.
- WebSocket measured with 200 clients under two scenarios: concurrent burst and uniform 5-second ramp.
- Figures below reflect medians; full reports retain MAD, min/max, and raw data.

This benchmark reflects BeatSync itself across these two commits, not a generic claim that Go is universally faster than Bun.

### Footprint & Low-Spec VPS Viability

| Metric | Bun | Go | Go Delta |
| --- | ---: | ---: | ---: |
| Process startup | 175.61 ms | 22.00 ms | **-87.5%**, ~8× faster |
| Idle RSS | 91.17 MiB | 9.79 MiB | **-89.3%** |
| RSS with 200 live WebSockets | 91.43 MiB | 24.26 MiB | **-73.5%** |
| Self-contained artifact | 96.04 MiB | 7.61 MiB | **-92.1%**, ~12.6× smaller |
| Production source lines | 5,713 lines | 3,809 lines | **-33.3%** |
| Direct production dependencies | 14 | 1 | Smaller surface area |

With 200 live WebSockets, the Go process uses ~67 MiB less memory. Under a 256 MiB budget, this workload accounts for ~9.5% with Go versus 35.7% with Bun (excluding OS, reverse proxy, extractor, `yt-dlp`, and audio cache).

Go adds ~14.42 MiB across 200 sockets, whereas Bun adds ~1.19 MiB because base runtime overhead already covers most allocations. Avoid linear extrapolation to thousands of clients without dedicated Linux benchmarks at 500 / 1,000 / 2,000 connections.

### HTTP on 1-vCPU Proxy

| Metric | Bun | Go | Go Delta |
| --- | ---: | ---: | ---: |
| Throughput, concurrency 1 | 10,731 req/s | 11,998 req/s | **+11.8%** |
| p99, concurrency 1 | 0.898 ms | 0.527 ms | **-41.3%** |
| Throughput, concurrency 32 | 41,953 req/s | 39,463 req/s | -5.9% |
| p95, concurrency 32 | 1.594 ms | 1.848 ms | +15.9% |
| p99, concurrency 32 | 3.031 ms | 3.393 ms | +11.9% |
| Requests/CPU-second, concurrency 32 | 51,307 | 50,334 | -1.9% |

Under 1-core constraints, CPU efficiency between backends is virtually identical. Go exchanges a minor tail latency difference under high concurrency for dramatically lower RAM usage—a favorable trade-off for low-spec VPS hosts where OOM is the main hazard. All HTTP workloads on both backends completed with zero errors.

When utilizing all 12 logical cores, Go achieved 18.8% higher throughput at concurrency 32, but consumed ~4.25× CPU time with 72.1% lower requests/CPU-second. The core justification for migration is **drastically reduced RAM and footprint with comparable 1-vCPU performance**.

### WebSocket

Under the 5-second ramp of 200 clients, both backends achieved stable performance across all runs:

| Metric | Bun | Go |
| --- | ---: | ---: |
| Handshakes completed | 200/200 | 200/200 |
| Sockets alive after 1s | 200/200 | 200/200 |
| NTP probes successful | 200/200 | 200/200 |
| NTP RTT p50 | 2.592 ms | 2.040 ms |

Under concurrent 200-connection burst, a backpressure bottleneck was identified:

- Bun answered 5,000/5,000 NTP probes across 5 runs.
- Go completed handshakes but answered 0/5,000 NTP probes across 5 full-CPU runs.
- The outbound queue in Go was bounded to 8 entries, disconnecting clients upon queue overflow. Multiple initial state messages plus user count broadcasts exceeded writer drain capacity.

> Post-benchmark status: the outbound queue was increased from 8 to 64 with bounded retention, maintaining fail-closed behavior for persistently slow clients, and covered with integration tests verifying NTP survival after 40-message bursts.

Production deployment checklist:
1. Coalesce "latest wins" state (especially user counts).
2. Avoid immediate socket teardown on brief bursts of non-essential messages.
3. Use bounded queue sizing based on memory measurements (never unbounded).
4. Add metrics for queue-full, forced-close, queue depth, and dropped/coalesced frames.
5. Include both burst and ramp tests in continuous integration.

### Correctness and API Parity

- Bun passed 112/114 tests; 2 failures related to active room filtering.
- Go passed 14/14 tests in initial benchmark suite (323 lines vs Bun's 2,131 lines).
- Both backends passed smoke tests for health, stats, active/discover/default, unconfigured voice, disabled uploads, and core WebSocket/NTP.
- Bun returns plain text errors; Go returns JSON `{ "error": ... }`.
- CORS preflight transitioned from HTTP 200 to 204.
- Go test suite has since expanded from 14 to 40+ tests covering room cleanup, audio timeouts, multi-room backups, hub backpressure, and hybrid worker auth/failover.

### Release Gates

1. 200-connection burst and 500-client ramp achieve 100% socket survival with <0.1% error rate.
2. Backward compatibility maintained for error schema.
3. Operational metrics available in `/stats`.
4. Extended Go test coverage matching Bun edge cases.
5. Linux VPS soak test (1 vCPU, 512 MiB cgroup) for 30–60 minutes.
6. Canary deployment with 5% traffic, monitoring RSS, CPU throttling, GC pauses, NTP latency, and dropped frames.

Reports and source data:

- [Full Report (Vietnamese)](.ecc/benchmarks/go-vs-bun/REPORT.vi.md)
- [Median & MAD Summary](.ecc/benchmarks/go-vs-bun/summary.json)
- [Raw Runtime Measurements](.ecc/benchmarks/go-vs-bun/raw-windows.json)
- [Raw WebSocket Ramp Data](.ecc/benchmarks/go-vs-bun/raw-ws-ramp.json)
- [API Parity Smoke Test](.ecc/benchmarks/go-vs-bun/parity-smoke.json)

<!-- AUTO-GENERATED: go-vs-bun-benchmark:end -->

## Repository Structure

```text
beatsync/
├── apps/
│   ├── client/                 # Next.js frontend
│   ├── server/                 # Go backend
│   │   ├── cmd/beatsync/       # Entrypoint
│   │   ├── internal/           # Application core
│   │   └── yt-rust-extractor/  # yt-dlp helper binary
│   └── storage/                # Object storage CORS configuration
├── packages/shared/            # Shared TypeScript/Zod schemas
├── scripts/                    # VPS setup and cgroup limits
├── compose.yml
└── Dockerfile
```

## License

This project is licensed under the [MIT License](LICENSE).
