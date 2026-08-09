#!/usr/bin/env bash
set -euo pipefail

log() { printf '%s\n' "[deploy] $1"; }

if [[ ! -f package.json || ! -f pm2.config.js ]]; then
  echo "Run update.sh from the beatsync repository root" >&2
  exit 1
fi

# Also protects manual deploys from overlapping the GitHub Actions deploy.
if command -v flock >/dev/null 2>&1; then
  exec 9>"/tmp/beatsync-deploy-${UID}.lock"
  if ! flock -n 9; then
    echo "Another Beatsync deployment is already running" >&2
    exit 1
  fi
fi

if [[ "${SKIP_PULL:-0}" != "1" ]]; then
  log "Pulling latest changes"
  git pull --ff-only origin main
fi

log "Installing dependencies"
bun install --frozen-lockfile

rollback_index="apps/server/dist/index.js.deploy-backup"
rollback_map="apps/server/dist/index.js.map.deploy-backup"
rollback_available=0
if [[ -f apps/server/dist/index.js ]]; then
  cp apps/server/dist/index.js "$rollback_index"
  [[ ! -f apps/server/dist/index.js.map ]] || cp apps/server/dist/index.js.map "$rollback_map"
  rollback_available=1
fi

log "Building server"
bun run --filter server build

log "Starting/reloading PM2 with the resilience config"
pm2 startOrReload pm2.config.js --update-env
pm2 save

log "Waiting for health check"
healthy=0
for _attempt in $(seq 1 15); do
  if curl -fsS --max-time 5 http://localhost:1001/health >/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done

if [ "$healthy" -ne 1 ]; then
  pm2 logs beatsync-server --lines 50 --nostream
  if [[ "$rollback_available" -eq 1 ]]; then
    log "Health check failed; restoring the previous server bundle"
    cp "$rollback_index" apps/server/dist/index.js
    [[ ! -f "$rollback_map" ]] || cp "$rollback_map" apps/server/dist/index.js.map
    pm2 reload pm2.config.js --update-env
    pm2 save
  fi
  exit 1
fi

[[ ! -f "$rollback_index" ]] || rm -f -- "$rollback_index"
[[ ! -f "$rollback_map" ]] || rm -f -- "$rollback_map"
pm2 show beatsync-server | grep -E "status|uptime|restarts|memory" || true
log "Deploy complete"
