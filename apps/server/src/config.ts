// Audio settings
export const AUDIO_LOW = 0.15;
export const AUDIO_HIGH = 1.0;
export const VOLUME_UP_RAMP_TIME = 0.5;
export const VOLUME_DOWN_RAMP_TIME = 0.5;

// Scheduling settings
export const MIN_SCHEDULE_TIME_MS = 400; // Minimum scheduling delay
export const DEFAULT_CLIENT_RTT_MS = 0; // Default RTT when no clients or initial value
const CAP_SCHEDULE_TIME_MS = 3_000; // Maximum scheduling delay

/**
 * Calculate dynamic scheduling delay based on maximum client RTT
 * @param maxRTT Maximum RTT among all clients in milliseconds
 * @returns Scheduling delay in milliseconds
 */
export function calculateScheduleTimeMs(maxRTT: number): number {
  // Use 1.5x the max RTT with a minimum of 400ms
  // The 1.5x factor provides buffer for jitter and processing time
  const dynamicDelay = Math.max(MIN_SCHEDULE_TIME_MS, maxRTT * 1.5 + 200);

  // Cap at 3000ms to prevent excessive delays
  return Math.min(dynamicDelay, CAP_SCHEDULE_TIME_MS);
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

// Resource protection defaults target a small (1 GB) Oracle VM. Every value can
// be overridden without rebuilding the server.
export const RESOURCE_LIMITS = {
  streamConcurrency: positiveIntegerEnv("STREAM_MAX_CONCURRENCY", 1),
  streamQueueSize: positiveIntegerEnv("STREAM_MAX_QUEUE", 20),
  maxAudioDownloadBytes: positiveIntegerEnv("MAX_AUDIO_DOWNLOAD_MB", 120) * 1024 * 1024,
  memorySoftLimitBytes: positiveIntegerEnv("MEMORY_SOFT_LIMIT_MB", 600) * 1024 * 1024,
  memoryHardLimitBytes: positiveIntegerEnv("MEMORY_HARD_LIMIT_MB", 750) * 1024 * 1024,
  memoryCheckIntervalMs: positiveIntegerEnv("MEMORY_CHECK_INTERVAL_MS", 5_000),
  restoreRoomConcurrency: positiveIntegerEnv("RESTORE_ROOM_CONCURRENCY", 4),
  restoreObjectConcurrency: positiveIntegerEnv("RESTORE_OBJECT_CONCURRENCY", 8),
} as const;
