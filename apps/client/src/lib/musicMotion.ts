/** A compact, local analysis of the decoded track for music-driven stereo motion. */
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
  boundaries: number[];
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

export const buildMusicMotionProfile = (buffer: MusicMotionBuffer): MusicMotionProfile => {
  const duration = Math.max(0, buffer.duration);
  const stepSeconds = Math.max(BASE_STEP_SECONDS, duration / (MAX_FRAMES - 1));
  const frameCount = Math.max(2, Math.ceil(duration / stepSeconds) + 1);
  const pan = new Float32Array(frameCount);
  const activity = new Float32Array(frameCount);
  const boundaries: number[] = [];
  const profile = { duration, stepSeconds, pan, activity, boundaries };
  if (!buffer.length || !buffer.sampleRate || duration < 0.2) return profile;

  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels ?? 1) }, (_, i) =>
    buffer.getChannelData(i)
  );
  const bands = [new Float32Array(frameCount), new Float32Array(frameCount), new Float32Array(frameCount)];
  const energy = new Float32Array(frameCount);

  // Three broad bands retain bass accents, vocal/melodic body and bright attacks.
  // Sampling is capped so a long track cannot make analysis unbounded on mobile.
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

  // Positive multi-band change is an onset cue. Compare the average timbre and
  // loudness before/after each moment to find phrase-like structural changes.
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

  let direction = 1;
  let lastBoundary = -Math.ceil(3 / stepSeconds);
  let previousPan = 0;
  const smoothing = 1 - Math.exp(-stepSeconds / 0.35);
  for (let i = 0; i < frameCount; i++) {
    const accent = clamp01(flux[i] / fluxScale);
    const change = clamp01(novelty[i] / noveltyScale);
    const sinceBoundary = (i - lastBoundary) * stepSeconds;
    const phrasePeak =
      i >= windowFrames && i < frameCount - windowFrames && novelty[i] >= novelty[i - 1] && novelty[i] > novelty[i + 1];
    const strongTransition = change > 0.62 && accent > 0.22;
    const resumedAfterBreak = i > 3 && energy[i - 3] < 0.16 && energy[i] > 0.4 && accent > 0.4;
    const importantAccent = sinceBoundary > 6 && change > 0.28 && accent > 0.85;
    if (sinceBoundary > 2.4 && ((phrasePeak && (strongTransition || importantAccent)) || resumedAfterBreak)) {
      direction *= -1;
      lastBoundary = i;
      boundaries.push(i * stepSeconds);
    }

    activity[i] = clamp01(energy[i] * 0.72 + accent * 0.28);
    const target = energy[i] < 0.06 ? 0 : direction * Math.min(1, 0.16 + energy[i] * 0.56 + accent * 0.28);
    previousPan += (target - previousPan) * smoothing;
    pan[i] = previousPan;
  }
  return profile;
};

export const getMusicMotionProfile = (buffer: MusicMotionBuffer) => {
  let profile = cache.get(buffer);
  if (!profile) {
    profile = buildMusicMotionProfile(buffer);
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
  };
};
