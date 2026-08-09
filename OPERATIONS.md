# Beatsync production resilience

The production defaults are tuned for an Oracle VM with 1 GB RAM:

- one active music download and at most 20 waiting jobs;
- reject new work and drop half of the waiting queue at 600 MB RSS;
- drop all waiting work, abort the active download, and write an atomic local snapshot at 750 MB RSS;
- request a PM2-supervised restart if RSS remains above 750 MB for three checks;
- PM2 performs an additional restart at 850 MB and restores the process after a crash;
- a 2 GB swap file and the `pm2-<user>` systemd unit survive OOM events and VM reboots.

State is saved first to `apps/server/data/state-backup-latest.json`, then to R2. Startup selects the newer valid snapshot, so a temporary R2/network failure does not require logging in to Oracle to recover rooms and playlists.

## Deployment

Push to `main` or run the `Deploy to VPS` GitHub Actions workflow. Deployments are serialized so rapid pushes cannot reload the VPS concurrently. The currently running bundle stays online while dependencies install and the new bundle builds. PM2 reloads only after a successful build; if `/health` fails, the script restores and reloads the previous server bundle automatically.

The host setup script is idempotent: it only creates `/swapfile` when that path does not already exist, enables PM2 at boot, deploys, saves the PM2 process list, and verifies `/health`.

Required repository secrets:

- `VPS_HOST`
- `VPS_USERNAME`
- `VPS_SSH_KEY`
- `VPS_FINGERPRINT` (SHA256 host-key fingerprint; prevents SSH man-in-the-middle attacks)

The deployment user needs passwordless `sudo` for the one-time swap/systemd configuration used by the workflow.

## Tuning

Override these in `pm2.config.js` or the environment. Keep the limits in this order:

```text
MEMORY_SOFT_LIMIT_MB < MEMORY_HARD_LIMIT_MB < PM2_MEMORY_LIMIT
```

For the default 1 GB VM, use `600 < 750 < 850`. `GET /health` exposes the current pressure level and stream queue counts; `GET /stats` includes detailed process memory.

Useful checks on the VM:

```bash
pm2 status
pm2 logs beatsync-server --lines 100
swapon --show
systemctl status pm2-$(id -un)
curl -fsS http://localhost:1001/health
```
