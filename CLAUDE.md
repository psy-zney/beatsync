# Repository guide

BeatSync is a Turborepo with a Next.js client and a standalone Go backend.

- `apps/client`: Next.js 16, React 19, Web Audio and LiveKit client.
- `apps/server/cmd/beatsync`: backend entry point.
- `apps/server/internal`: HTTP/WebSocket application, rooms, bounded queue, memory monitor, S3 SigV4, backup, Spotify and YouTube services.
- `apps/server/yt-rust-extractor`: small `yt-dlp` wrapper. It is built in CI, never on the VPS.
- `packages/shared`: client-side schemas that define the backend wire contract.

Backend commands (from `apps/server`):

```bash
go test ./...
go run ./cmd/beatsync
go build -trimpath -o dist/beatsync-server ./cmd/beatsync
```

The production backend is a single systemd process because room/WebSocket state is in memory. Downloads must stay streaming and bounded; do not replace them with `io.ReadAll`. Preserve JSON field names and WS action/response shapes from `packages/shared/types`.

Deployment is artifact-based through `.github/workflows/deploy.yml`. The VPS does not install application dependencies or compilers. Runtime secrets remain in `apps/server/.env` on the VPS.
