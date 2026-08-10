#!/usr/bin/env bash
# Installs a pre-built release. Run as root; compilation stays in GitHub Actions.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_HOME="${DEPLOY_HOME:-/home/$DEPLOY_USER}"
RELEASE_ID="${RELEASE_ID:-}"
BUNDLE_PATH="${BUNDLE_PATH:-}"
INSTALL_ROOT="/opt/beatsync"

[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] || { echo "Invalid DEPLOY_USER" >&2; exit 1; }
[[ "$DEPLOY_HOME" == /* && "$DEPLOY_HOME" != "/" ]] || { echo "Invalid DEPLOY_HOME" >&2; exit 1; }
[[ "$RELEASE_ID" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid RELEASE_ID" >&2; exit 1; }
[[ "$BUNDLE_PATH" == /tmp/beatsync-*.tar.gz && -f "$BUNDLE_PATH" && ! -L "$BUNDLE_PATH" ]] || { echo "Invalid BUNDLE_PATH" >&2; exit 1; }

release_dir="$INSTALL_ROOT/releases/$RELEASE_ID"
repo_dir="$DEPLOY_HOME/beatsync"
env_file="$repo_dir/apps/server/.env"
data_dir="$repo_dir/apps/server/data"
install -d -m 755 "$INSTALL_ROOT/releases" "$release_dir"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 750 "$data_dir"
tar -xzf "$BUNDLE_PATH" -C "$release_dir" --no-same-owner --no-same-permissions
for binary in beatsync-server yt-rust-extractor yt-dlp; do
  [[ -f "$release_dir/$binary" && ! -L "$release_dir/$binary" ]] || { echo "Bundle is missing $binary" >&2; exit 1; }
  chmod 755 "$release_dir/$binary"
done

previous=""
if [[ -L "$INSTALL_ROOT/current" ]]; then previous="$(readlink -f "$INSTALL_ROOT/current")"; fi
ln -sfn "$release_dir" "$INSTALL_ROOT/current.next"
mv -Tf "$INSTALL_ROOT/current.next" "$INSTALL_ROOT/current"

# First Go deployment: remove only the old BeatSync PM2 process. Other PM2
# applications owned by the same user are deliberately left untouched.
pm2_bin="$DEPLOY_HOME/.bun/bin/pm2"
if [[ -x "$pm2_bin" ]]; then
  runuser -u "$DEPLOY_USER" -- env HOME="$DEPLOY_HOME" PM2_HOME="$DEPLOY_HOME/.pm2" "$pm2_bin" delete beatsync-server >/dev/null 2>&1 || true
  runuser -u "$DEPLOY_USER" -- env HOME="$DEPLOY_HOME" PM2_HOME="$DEPLOY_HOME/.pm2" "$pm2_bin" save --force >/dev/null 2>&1 || true
fi

cat >/etc/systemd/system/beatsync.service <<UNIT
[Unit]
Description=BeatSync Go backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$DEPLOY_USER
Group=$DEPLOY_USER
WorkingDirectory=$repo_dir/apps/server
EnvironmentFile=-$env_file
Environment=GOMEMLIMIT=220MiB
Environment=GOGC=75
ExecStart=/usr/bin/env MEMORY_SOFT_LIMIT_MB=220 MEMORY_HARD_LIMIT_MB=320 STREAM_MAX_CONCURRENCY=1 STREAM_MAX_QUEUE=12 $INSTALL_ROOT/current/beatsync-server
Restart=always
RestartSec=3s
TimeoutStopSec=20s
KillSignal=SIGTERM
OOMPolicy=stop
MemoryHigh=300M
MemoryMax=420M
MemorySwapMax=256M
TasksMax=128
LimitNOFILE=65536
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=$data_dir
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable beatsync.service >/dev/null
systemctl restart beatsync.service

port="${HEALTH_PORT:-}"
if [[ -z "$port" && -f "$env_file" ]]; then port="$(awk -F= '$1 == "PORT" { print $2; exit }' "$env_file" | tr -d '[:space:]"')"; fi
port="${port:-1001}"
if [[ ! "$port" =~ ^[1-9][0-9]{0,4}$ ]] || ((port > 65535)); then echo "Invalid health port" >&2; exit 1; fi
healthy=0
for _attempt in $(seq 1 20); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${port}/health" >/dev/null; then healthy=1; break; fi
  sleep 2
done

if [[ "$healthy" -ne 1 ]]; then
  journalctl -u beatsync.service --no-pager -n 80 || true
  if [[ -n "$previous" && "$previous" == "$INSTALL_ROOT/releases/"* && -d "$previous" ]]; then
    ln -sfn "$previous" "$INSTALL_ROOT/current.next"
    mv -Tf "$INSTALL_ROOT/current.next" "$INSTALL_ROOT/current"
    systemctl restart beatsync.service
    echo "Health check failed; previous release restored" >&2
  fi
  exit 1
fi

rm -f -- "$BUNDLE_PATH"
if [[ -d "$repo_dir/apps/server/node_modules" && ! -L "$repo_dir/apps/server/node_modules" ]]; then rm -rf -- "$repo_dir/apps/server/node_modules"; fi
echo "BeatSync release $RELEASE_ID is healthy."
