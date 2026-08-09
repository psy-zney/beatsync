#!/usr/bin/env bash
# Idempotent host setup for a small Oracle Ubuntu VM.
set -euo pipefail

SWAP_SIZE_GB="${SWAP_SIZE_GB:-2}"
SWAP_FILE="${SWAP_FILE:-/swapfile}"
DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:-ubuntu}}"
DEPLOY_HOME="${DEPLOY_HOME:-/home/$DEPLOY_USER}"
PM2_BIN="${PM2_BIN:-$DEPLOY_HOME/.bun/bin/pm2}"

if [[ ! "$SWAP_SIZE_GB" =~ ^[1-9][0-9]*$ ]]; then
  echo "SWAP_SIZE_GB must be a positive integer" >&2
  exit 1
fi
if [[ "$SWAP_FILE" != /* ]] || [[ "$SWAP_FILE" == "/" ]] || [[ -L "$SWAP_FILE" ]]; then
  echo "Refusing unsafe SWAP_FILE: $SWAP_FILE" >&2
  exit 1
fi

if ! swapon --show=NAME --noheadings | grep -Fxq "$SWAP_FILE"; then
  if [[ -e "$SWAP_FILE" ]]; then
    echo "$SWAP_FILE exists but is not active; refusing to overwrite it" >&2
    exit 1
  fi
  echo "Creating ${SWAP_SIZE_GB}G swap at $SWAP_FILE"
  fallocate -l "${SWAP_SIZE_GB}G" "$SWAP_FILE" || dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$((SWAP_SIZE_GB * 1024))" status=progress
  chmod 600 "$SWAP_FILE"
  mkswap "$SWAP_FILE"
  swapon "$SWAP_FILE"
  printf '%s\n' "$SWAP_FILE none swap sw 0 0" >>/etc/fstab
fi

# Prefer swapping over killing the PM2 supervisor, but still keep swapping low.
printf '%s\n' "vm.swappiness=10" >/etc/sysctl.d/99-beatsync-memory.conf
sysctl --system >/dev/null

if [[ -x "$PM2_BIN" ]]; then
  env PATH="$(dirname "$PM2_BIN"):/usr/local/bin:/usr/bin:/bin" \
    "$PM2_BIN" startup systemd -u "$DEPLOY_USER" --hp "$DEPLOY_HOME" >/dev/null
else
  echo "PM2 not found at $PM2_BIN; swap is configured but systemd startup was skipped" >&2
  exit 1
fi

echo "Oracle memory resilience configured (swap + PM2 systemd startup)."
