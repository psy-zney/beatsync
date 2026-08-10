export const R2_AUDIO_FILE_NAME_DELIMITER = "___";

const STEADY_STATE_INTERVAL_MS = 30_000;

// NTP Heartbeat Constants
export const NTP_CONSTANTS = {
  // Two probes are sent per measurement. A 500 ms interval keeps initial
  // calibration quick without creating a burst on a small VPS.
  INITIAL_INTERVAL_MS: 500,
  // Clock drift is slow, so recalibrating every 30 seconds is sufficient.
  STEADY_STATE_INTERVAL_MS: STEADY_STATE_INTERVAL_MS,
  // Background tabs rely on the WebSocket control ping for liveness and only
  // refresh their clock occasionally.
  BACKGROUND_INTERVAL_MS: 60_000,
  // Spread steady probes across time so clients do not hit the VPS together.
  STEADY_STATE_JITTER_RATIO: 0.2,
  // Eight min-RTT samples are enough for a stable initial estimate and halve
  // the previous calibration traffic.
  MAX_MEASUREMENTS: 8,
  // Coded probes (Huygens) — inter-departure gap between probe pairs
  // Large enough gap to avoid TCP coalescing where browsers batch small writes into one segment
  PROBE_GAP_MS: 25,
  // Coded probes — client accepts server gap within ±this tolerance
  PROBE_GAP_TOLERANCE_MS: 15,
} as const;

export const LOW_PASS_CONSTANTS = {
  MIN_FREQ: 20,
  MAX_FREQ: 20000,
} as const;

export const CHAT_CONSTANTS = {
  MAX_MESSAGE_LENGTH: 20_000,
} as const;
