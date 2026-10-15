import type { LrcLine } from "./lrc";

/** A compact, local analysis of the decoded track for music-driven stereo/3D motion. */
export interface MusicMotionBuffer {
  duration: number;
  length: number;
  sampleRate: number;
  numberOfChannels?: number;
  getChannelData(channel: number): Float32Array;
}

export interface MusicMotionProfile {
  duration: number;
  stepSeconds: number;
  pan: Float32Array;
  activity: Float32Array;
  elevation: Float32Array;
  depth: Float32Array;
  boundaries: number[];
  isLyricsSynced: boolean;
}

const MAX_FRAMES = 12_000;
const MAX_SAMPLES_PER_FRAME = 512;
const BASE_STEP_SECONDS = 0.1;
const cache = new WeakMap<MusicMotionBuffer, MusicMotionProfile>();
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const percentile = (values: Float32Array, fraction: number) => {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0;
};

const movingDifference = (values: Float32Array, radius: number) => {
  const prefix = new Float64Array(values.length + 1);
  const differences = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i] + values[i];
  for (let i = radius; i < values.length - radius; i++) {
    const before = (prefix[i] - prefix[i - radius]) / radius;
    const after = (prefix[i + radius] - prefix[i]) / radius;
    differences[i] = Math.abs(after - before);
  }
  return differences;
};

export const buildMusicMotionProfile = (buffer: MusicMotionBuffer, lyricsLines?: LrcLine[]): MusicMotionProfile => {
  const duration = Math.max(0, buffer.duration);
  const stepSeconds = Math.max(BASE_STEP_SECONDS, duration / (MAX_FRAMES - 1));
  const frameCount = Math.max(2, Math.ceil(duration / stepSeconds) + 1);
  const pan = new Float32Array(frameCount);
  const activity = new Float32Array(frameCount);
  const elevation = new Float32Array(frameCount);
  const depth = new Float32Array(frameCount);
  const boundaries: number[] = [];
  const profile: MusicMotionProfile = {
    duration,
    stepSeconds,
    pan,
    activity,
    elevation,
    depth,
    boundaries,
    isLyricsSynced: false,
  };
  if (!buffer.length || !buffer.sampleRate || duration < 0.2) return profile;

  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels ?? 1) }, (_, i) =>
    buffer.getChannelData(i)
  );
  const bands = [new Float32Array(frameCount), new Float32Array(frameCount), new Float32Array(frameCount)];
  const energy = new Float32Array(frameCount);

  // Three broad bands retain bass accents, vocal/melodic body and bright attacks.
  // Band 0: Lows / Kick & Sub-bass (< 180Hz)
  // Band 1: Mids / Vocal core (180Hz - 1800Hz)
  // Band 2: Highs / Air & Cymbals (> 1800Hz)
  for (let frame = 0; frame < frameCount; frame++) {
    const center = Math.min(duration, frame * stepSeconds);
    const start = Math.max(0, Math.floor((center - 0.045) * buffer.sampleRate));
    const end = Math.min(buffer.length, Math.ceil((center + 0.045) * buffer.sampleRate));
    const stride = Math.max(1, Math.ceil((end - start) / MAX_SAMPLES_PER_FRAME));
    const sampleInterval = stride / buffer.sampleRate;
    const lowAlpha = 1 - Math.exp(-2 * Math.PI * 180 * sampleInterval);
    const midAlpha = 1 - Math.exp(-2 * Math.PI * 1800 * sampleInterval);
    let lowPower = 0;
    let midPower = 0;
    let highPower = 0;
    let count = 0;
    for (const samples of channels) {
      let lowPass = 0;
      let midPass = 0;
      for (let index = start; index < end; index += stride) {
        const sample = samples[index];
        lowPass += lowAlpha * (sample - lowPass);
        midPass += midAlpha * (sample - midPass);
        const mid = midPass - lowPass;
        const high = sample - midPass;
        lowPower += lowPass * lowPass;
        midPower += mid * mid;
        highPower += high * high;
        count++;
      }
    }
    if (!count) continue;
    const low = Math.sqrt(lowPower / count);
    const mid = Math.sqrt(midPower / count);
    const high = Math.sqrt(highPower / count);
    bands[0][frame] = Math.log1p(low * 20);
    bands[1][frame] = Math.log1p(mid * 20);
    bands[2][frame] = Math.log1p(high * 20);
    energy[frame] = Math.log1p(Math.hypot(low, mid, high) * 20);
  }

  const energyScale = Math.max(0.05, percentile(energy, 0.9));
  for (let i = 0; i < frameCount; i++) energy[i] = clamp01(energy[i] / energyScale);
  for (const band of bands) {
    const scale = Math.max(0.05, percentile(band, 0.9));
    for (let i = 0; i < frameCount; i++) band[i] = clamp01(band[i] / scale);
  }

  // Multi-band spectral flux is an onset cue.
  const flux = new Float32Array(frameCount);
  for (let i = 1; i < frameCount; i++) {
    flux[i] =
      0.35 * Math.max(0, bands[0][i] - bands[0][i - 1]) +
      0.4 * Math.max(0, bands[1][i] - bands[1][i - 1]) +
      0.25 * Math.max(0, bands[2][i] - bands[2][i - 1]);
  }
  const fluxScale = Math.max(0.08, percentile(flux, 0.9));
  const windowFrames = Math.max(3, Math.round(1.2 / stepSeconds));
  const changes = bands.map((band) => movingDifference(band, windowFrames));
  changes.push(movingDifference(energy, windowFrames));
  const novelty = new Float32Array(frameCount);
  for (let i = windowFrames; i < frameCount - windowFrames; i++) {
    novelty[i] = 0.2 * changes[0][i] + 0.3 * changes[1][i] + 0.2 * changes[2][i] + 0.3 * changes[3][i];
  }
  const noveltyScale = Math.max(0.12, percentile(novelty, 0.9));

  // Determine if valid timed lyrics are available (Method B: Lyrics Sync)
  const validLyrics = lyricsLines?.filter(
    (l) => Number.isFinite(l.time) && l.time >= 0 && l.text?.trim() && !l.text.startsWith("[")
  );
  const hasTimedLyrics = Boolean(validLyrics && validLyrics.length >= 2);
  profile.isLyricsSynced = hasTimedLyrics;

  if (hasTimedLyrics && validLyrics) {
    // --- Method B: Alternating per lyric line + Method C: Dynamic Energy ---
    let previousPan = 0;
    const baseSmoothing = 1 - Math.exp(-stepSeconds / 0.28);

    for (let i = 0; i < frameCount; i++) {
      const time = i * stepSeconds;
      const accent = clamp01(flux[i] / fluxScale);
      const bassEnergy = bands[0][i];

      // Find active lyric line
      let lineIndex = -1;
      for (let idx = 0; idx < validLyrics.length; idx++) {
        const line = validLyrics[idx];
        const nextLine = validLyrics[idx + 1];
        const endTime = line.end ?? (nextLine ? nextLine.time - 0.15 : line.time + 4.0);
        if (time >= line.time && time <= endTime) {
          lineIndex = idx;
          break;
        }
      }

      let target = 0;
      if (lineIndex !== -1) {
        // Line active: alternate Left (-1) and Right (+1)
        const side = lineIndex % 2 === 0 ? -1 : 1;
        const lineAmp = 0.7 + 0.25 * energy[i];
        // Dynamic rhythmic kick pulse in high energy sections (Method C)
        const microBeat = Math.sin(time * 6.28) * 0.12 * bassEnergy;
        target = side * lineAmp + microBeat;
        if (
          boundaries.length === 0 ||
          Math.abs(boundaries[boundaries.length - 1] - validLyrics[lineIndex].time) > 0.5
        ) {
          boundaries.push(validLyrics[lineIndex].time);
        }
      } else {
        // Instrumental break / pause between lines: gentle floating center
        target = Math.sin(time * 0.8) * 0.2 * energy[i];
      }

      // Faster adaptation during high bass energy drops
      const speedMultiplier = bassEnergy > 0.7 ? 2.2 : bassEnergy > 0.4 ? 1.4 : 0.9;
      const smoothing = clamp01(baseSmoothing * speedMultiplier);
      previousPan += (target - previousPan) * smoothing;
      pan[i] = Math.max(-1, Math.min(1, previousPan));

      activity[i] = clamp01(energy[i] * 0.72 + accent * 0.28);
      const angle = pan[i] * (Math.PI / 2.2);
      depth[i] = -2.0 * Math.cos(angle);
      elevation[i] = (bassEnergy - 0.5) * 0.5;
    }
  } else {
    // --- Method A: Silence / Envelope Onset + Method C: Dynamic Energy ---
    let direction = 1;
    let lastBoundary = -Math.ceil(3 / stepSeconds);
    let previousPan = 0;

    for (let i = 0; i < frameCount; i++) {
      const accent = clamp01(flux[i] / fluxScale);
      const change = clamp01(novelty[i] / noveltyScale);
      const sinceBoundary = (i - lastBoundary) * stepSeconds;
      const bassEnergy = bands[0][i];

      const phrasePeak =
        i >= windowFrames &&
        i < frameCount - windowFrames &&
        novelty[i] >= novelty[i - 1] &&
        novelty[i] > novelty[i + 1];
      const strongTransition = change > 0.62 && accent > 0.22;
      const resumedAfterBreak = i > 3 && energy[i - 3] < 0.16 && energy[i] > 0.4 && accent > 0.4;
      const importantAccent = sinceBoundary > 6 && change > 0.28 && accent > 0.85;

      // Vocal onset detection (Method A): vocal gap followed by sudden onset
      const vocalOnset = i > 2 && bands[1][i - 2] < 0.15 && bands[1][i] > 0.35 && accent > 0.3 && sinceBoundary > 2.0;

      if (
        sinceBoundary > 2.4 &&
        ((phrasePeak && (strongTransition || importantAccent)) || resumedAfterBreak || vocalOnset)
      ) {
        direction *= -1;
        lastBoundary = i;
        boundaries.push(i * stepSeconds);
      }

      activity[i] = clamp01(energy[i] * 0.72 + accent * 0.28);

      // In drops/chorus with high bass, add beat-synced snapping/pulse
      const dynamicSpeed = bassEnergy > 0.75 ? 2.5 : bassEnergy > 0.45 ? 1.5 : 0.8;
      const smoothing = 1 - Math.exp((-stepSeconds * dynamicSpeed) / 0.35);

      const target = energy[i] < 0.06 ? 0 : direction * Math.min(1, 0.16 + energy[i] * 0.56 + accent * 0.28);

      previousPan += (target - previousPan) * smoothing;
      pan[i] = Math.max(-1, Math.min(1, previousPan));

      const angle = pan[i] * (Math.PI / 2.2);
      depth[i] = -2.0 * Math.cos(angle);
      elevation[i] = (bassEnergy - 0.5) * 0.5;
    }
  }

  return profile;
};

export const getMusicMotionProfile = (buffer: MusicMotionBuffer, lyricsLines?: LrcLine[]) => {
  let profile = cache.get(buffer);
  if (!profile || (lyricsLines && lyricsLines.length >= 2 && !profile.isLyricsSynced)) {
    profile = buildMusicMotionProfile(buffer, lyricsLines);
    cache.set(buffer, profile);
  }
  return profile;
};

export const sampleMusicMotion = (profile: MusicMotionProfile, timeSeconds: number) => {
  const position = Math.max(0, Math.min(profile.pan.length - 1, timeSeconds / profile.stepSeconds));
  const index = Math.floor(position);
  const next = Math.min(profile.pan.length - 1, index + 1);
  const fraction = position - index;
  return {
    pan: profile.pan[index] * (1 - fraction) + profile.pan[next] * fraction,
    activity: profile.activity[index] * (1 - fraction) + profile.activity[next] * fraction,
    elevation: profile.elevation ? profile.elevation[index] * (1 - fraction) + profile.elevation[next] * fraction : 0,
    depth: profile.depth ? profile.depth[index] * (1 - fraction) + profile.depth[next] * fraction : -2,
    isLyricsSynced: profile.isLyricsSynced ?? false,
  };
};
