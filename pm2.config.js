// Single process is intentional: room/WebSocket state is held in memory.
module.exports = {
  apps: [
    {
      name: "beatsync-server",
      cwd: "apps/server",
      script: "dist/index.js",
      interpreter: "bun",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      min_uptime: "10s",
      max_restarts: 20,
      exp_backoff_restart_delay: 100,
      max_memory_restart: process.env.PM2_MEMORY_LIMIT || "850M",
      kill_timeout: 15000,
      time: true,
      merge_logs: true,
      env: {
        NODE_ENV: "production",
        PATH: `/usr/local/bin:${process.env.HOME}/.bun/bin:${process.env.PATH}`,
        STREAM_MAX_CONCURRENCY: "1",
        STREAM_MAX_QUEUE: "20",
        MAX_AUDIO_DOWNLOAD_MB: "120",
        MEMORY_SOFT_LIMIT_MB: "600",
        MEMORY_HARD_LIMIT_MB: "750",
        MEMORY_CHECK_INTERVAL_MS: "5000",
        RESTORE_ROOM_CONCURRENCY: "4",
        RESTORE_OBJECT_CONCURRENCY: "8",
      },
    },
  ],
};
