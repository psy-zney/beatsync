#!/usr/bin/env bash
# Manual installer for a bundle already built by GitHub Actions.
set -euo pipefail
bundle="${BEATSYNC_BUNDLE:-${1:-}}"
release_id="${RELEASE_ID:-}"
if [[ -z "$bundle" || -z "$release_id" ]]; then
  echo "Use the Deploy to VPS workflow, or set BEATSYNC_BUNDLE and RELEASE_ID (40-char commit SHA)." >&2
  exit 2
fi
sudo env BUNDLE_PATH="$bundle" RELEASE_ID="$release_id" DEPLOY_USER="$(id -un)" DEPLOY_HOME="$HOME" bash scripts/install-go-backend.sh
