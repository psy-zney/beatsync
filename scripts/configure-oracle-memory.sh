#!/usr/bin/env bash
# Idempotent one-time host preparation for a small Oracle Ubuntu VM.
set -euo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

SWAP_SIZE_GB="${SWAP_SIZE_GB:-2}"
SWAP_FILE="${SWAP_FILE:-/swapfile}"
if [[ ! "$SWAP_SIZE_GB" =~ ^[1-9][0-9]*$ ]]; then echo "Invalid SWAP_SIZE_GB" >&2; exit 1; fi
if [[ "$SWAP_FILE" != /* || "$SWAP_FILE" == "/" || -L "$SWAP_FILE" ]]; then echo "Unsafe SWAP_FILE" >&2; exit 1; fi

if ! swapon --show=NAME --noheadings | grep -Fxq "$SWAP_FILE"; then
  if [[ -e "$SWAP_FILE" ]]; then echo "$SWAP_FILE exists but is not active; refusing to overwrite it" >&2; exit 1; fi
  fallocate -l "${SWAP_SIZE_GB}G" "$SWAP_FILE" || dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$((SWAP_SIZE_GB * 1024))" status=progress
  chmod 600 "$SWAP_FILE"
  mkswap "$SWAP_FILE" >/dev/null
  swapon "$SWAP_FILE"
  printf '%s\n' "$SWAP_FILE none swap sw 0 0" >>/etc/fstab
fi

printf '%s\n' 'vm.swappiness=10' 'vm.overcommit_memory=0' >/etc/sysctl.d/99-beatsync-memory.conf
sysctl --system >/dev/null
echo "Oracle memory resilience configured (swap + conservative swapping)."
