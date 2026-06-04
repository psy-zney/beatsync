# Beatsync

Beatsync is a high-precision web audio player built for multi-device playback. The official app is [beatsync.gg](https://www.beatsync.gg/).

https://github.com/user-attachments/assets/2aa385a7-2a07-4ab5-80b1-fda553efc57b

## Features

- **Millisecond-accurate synchronization**: Abstracts [NTP-inspired](https://en.wikipedia.org/wiki/Network_Time_Protocol) time synchronization primitives to achieve a high degree of accuracy
- **Cross-platform**: Works on any device with a modern browser (Chrome recommended for best performance)
- **Spatial audio:** Allows controlling device volumes through a virtual listening source for interesting sonic effects
- **Polished interface**: Smooth loading states, status indicators, and all UI elements come built-in
- **Self-hostable**: Run your own instance with a few commands


> [!NOTE]
> Beatsync is in early development. Mobile support is working, but experimental. Please consider creating an issue or contributing with a PR if you run into problems!

## Quickstart

This project uses [Turborepo](https://turbo.build/repo).

Copy env examples first:

```sh
cp apps/client/.env.example apps/client/.env
cp apps/server/.env.example apps/server/.env
```

Run the following commands to start the server and client:

```sh
bun install          # installs once for all workspaces
bun dev              # starts both client (:3000) and server (:8080)
```

Local env defaults:

```sh
# apps/client/.env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws
NEXT_PUBLIC_DEMO_MODE=0

# apps/server/.env
HOST=0.0.0.0
PORT=8080
PROVIDER_URL=
CREATOR_SECRET=
```

## Vercel Deployment

Beatsync cannot run fully on Vercel alone because this repo uses a long-lived Bun WebSocket server in `apps/server`.

Deploy it in 2 parts:

1. `apps/client` on Vercel
2. `apps/server` on another host that supports persistent processes and WebSockets
   Examples: Railway, Render, Fly.io, VPS, or your own machine behind ngrok

### 1. Deploy frontend to Vercel

Create a Vercel project that points to this repo with:

- Root Directory: `apps/client`
- Build Command: `next build`
- Install Command: `bun install`
- Output Directory: `.next`

Set these Vercel environment variables:

```sh
NEXT_PUBLIC_API_URL=https://YOUR-BACKEND-DOMAIN
NEXT_PUBLIC_WS_URL=wss://YOUR-BACKEND-DOMAIN/ws
NEXT_PUBLIC_DEMO_MODE=0
NEXT_PUBLIC_POSTHOG_KEY=
```

Important:

- `NEXT_PUBLIC_WS_URL` must use `wss://` in production
- The backend domain must be reachable publicly
- Do not point Vercel to `localhost`

### 2. Run backend separately

On any machine/server that can keep Bun running:

```sh
cp apps/server/.env.example apps/server/.env
cd apps/server
bun install
bun run build
bun run start
```

For development:

```sh
cd apps/server
bun run dev
```

The backend listens on:

- `HOST=0.0.0.0`
- `PORT=8080` by default

### 3. Temporary backend with ngrok

If you want to test Vercel frontend against your local backend:

Run backend locally:

```sh
cd apps/server
bun run dev
```

Expose it:

```sh
ngrok http 8080
```

Then set Vercel env to the ngrok URL:

```sh
NEXT_PUBLIC_API_URL=https://YOUR-NGROK.ngrok-free.app
NEXT_PUBLIC_WS_URL=wss://YOUR-NGROK.ngrok-free.app/ws
```

Redeploy the Vercel project after changing env vars.

### 4. Full local run

Run both apps together:

```sh
bun install
bun dev
```

Or separately:

```sh
cd apps/server && bun run dev
cd apps/client && bun run dev
```

Open:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8080`

### 5. Troubleshooting

- `502 /ws` on ngrok usually means nothing is listening on port `8080`
- `WebSocket upgrade failed` usually means the client is hitting the wrong backend URL
- If frontend is on HTTPS, WebSocket must be `wss://`, not `ws://`
- Vercel env changes require a redeploy
- If uploads/default tracks depend on object storage, update `S3_*` values in `apps/server/.env`

| Directory         | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `apps/server`     | Bun HTTP + WebSocket server                                    |
| `apps/client`     | Next.js frontend with Tailwind & Shadcn/ui                     |
| `packages/shared` | Type-safe schemas and functions shared between client & server |
