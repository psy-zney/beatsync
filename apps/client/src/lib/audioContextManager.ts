import { LOW_PASS_CONSTANTS } from "@beatsync/shared";
import { getMusicMotionProfile, sampleMusicMotion, type MusicMotionProfile } from "./musicMotion";
import type { LrcLine } from "./lrc";

/** iOS 18+ uses a non-standard "interrupted" state (e.g. phone call, Siri) */
export function isAudioContextPaused(state: AudioContextState | string | undefined | null): boolean {
  return state === "suspended" || state === "interrupted";
}

// Minimal silent WAV (1 sample, 44.1kHz, 16-bit mono, 46 bytes).
const SILENCE_DATA_URL = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==";

/**
 * Creates a subtle synthetic impulse response for the producer ambience reverb.
 * Provides soft diffuse reflections so that hard 3D pans never feel artificially isolated in one ear.
 */
function createAmbienceImpulse(context: AudioContext, durationSeconds = 0.5, decay = 2.8): AudioBuffer {
  const rate = context.sampleRate || 44100;
  const length = Math.max(1, Math.floor(rate * durationSeconds));
  const buffer = context.createBuffer(2, length, rate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const t = i / length;
    const env = Math.exp(-decay * t);
    left[i] = (Math.random() * 2 - 1) * env;
    right[i] = (Math.random() * 2 - 1) * env;
  }
  return buffer;
}

/**
 * Singleton AudioContext Manager
 *
 * Manages the single AudioContext instance with:
 * 1. Bass Anchor: 200Hz Frequency Splitting (Bass/Kick center, Mids/Highs 3D fly)
 * 2. Device optimization: Headphones (HRTF 3D Panner) vs Speakers (Stereo + Haas delay)
 * 3. Producer subtle room ambience reverb
 * 4. Lyrics sync & music-driven dynamic automation
 */
class AudioContextManager {
  private static instance: AudioContextManager | null = null;
  private audioContext: AudioContext | null = null;
  private masterGainNode: GainNode | null = null;
  private lowPassFilterNode: BiquadFilterNode | null = null;

  // Fly Frequency-Splitting & Spatial Nodes
  private flyInputGain: GainNode | null = null;
  private flyBypassGain: GainNode | null = null;
  private flyBassFilter: BiquadFilterNode | null = null;
  private flyBassGain: GainNode | null = null;
  private flyHighFilter: BiquadFilterNode | null = null;
  private flyHighGain: GainNode | null = null;
  private panner3D: PannerNode | null = null;
  private stereoPannerNode: StereoPannerNode | null = null;
  private flyHeadphonesGain: GainNode | null = null;
  private flySpeakersGain: GainNode | null = null;
  private haasDelayNode: DelayNode | null = null;
  private haasGainNode: GainNode | null = null;
  private ambienceConvolver: ConvolverNode | null = null;
  private ambienceGain: GainNode | null = null;
  private vocalAnalyser: AnalyserNode | null = null;
  private bassAnalyser: AnalyserNode | null = null;

  private flyMode: "off" | "auto" | "manual" = "off";
  private flyOutputDevice: "headphones" | "speakers" = "headphones";
  private flyDepth = 0;
  private flyManualPan = 0;
  private flyTrack: {
    buffer: AudioBuffer;
    profile?: MusicMotionProfile;
    startTime: number;
    offset: number;
    lyricsLines?: LrcLine[];
  } | null = null;
  private flyRelease: { pan: number; startTime: number } | null = null;

  private stateChangeCallbacks: Set<(state: AudioContextState) => void> = new Set();
  private wakeLock: WakeLockSentinel | null = null;
  private hasVisibilityListener = false;
  private silentAudioElement: HTMLAudioElement | null = null;
  private hasRegisteredGestureListeners = false;

  private constructor() {}

  static getInstance(): AudioContextManager {
    if (!AudioContextManager.instance) {
      AudioContextManager.instance = new AudioContextManager();
    }
    return AudioContextManager.instance;
  }

  getContext(): AudioContext {
    if (!this.audioContext) {
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      this.audioContext = new AudioContextClass({
        latencyHint: "interactive",
      });

      this.setupMasterGain();
      this.setupStateChangeListener();
      this.setupWakeLock();
      this.setupSafariAudioSessionWorkaround();
      this.registerFirstGestureListeners();
    }
    return this.audioContext;
  }

  private registerFirstGestureListeners(): void {
    if (this.hasRegisteredGestureListeners || typeof window === "undefined") return;
    this.hasRegisteredGestureListeners = true;

    const resumeOnGesture = () => {
      if (this.audioContext && isAudioContextPaused(this.audioContext.state)) {
        this.audioContext
          .resume()
          .then(() => {
            const state = this.audioContext?.state as AudioContextState | undefined;
            if (state === "running") {
              this.notifyStateChange("running");
            }
          })
          .catch((err) => {
            console.warn("[AudioContextManager] Resume on gesture failed:", err);
          });
      }
    };

    const options: AddEventListenerOptions = { capture: true, passive: true };
    window.addEventListener("click", resumeOnGesture, options);
    window.addEventListener("touchstart", resumeOnGesture, options);
    window.addEventListener("keydown", resumeOnGesture, options);
  }

  private setupSafariAudioSessionWorkaround(): void {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!isIOS) return;

    try {
      const audio = document.createElement("audio");
      audio.setAttribute("playsinline", "");
      audio.setAttribute("webkit-playsinline", "");
      audio.src = SILENCE_DATA_URL;
      audio.loop = true;
      audio.volume = 0.01;
      this.silentAudioElement = audio;

      const startSilentAudio = () => {
        if (!this.silentAudioElement) return;
        this.silentAudioElement.play().catch(() => {});
        window.removeEventListener("touchend", startSilentAudio, true);
        window.removeEventListener("click", startSilentAudio, true);
      };

      window.addEventListener("touchend", startSilentAudio, { capture: true, once: true });
      window.addEventListener("click", startSilentAudio, { capture: true, once: true });
    } catch (e) {
      console.warn("[AudioContextManager] Could not setup iOS audio workaround:", e);
    }
  }

  private async setupWakeLock(): Promise<void> {
    if (typeof window === "undefined" || !("wakeLock" in navigator)) return;
    const requestLock = async () => {
      try {
        if (document.visibilityState === "visible" && !this.wakeLock) {
          this.wakeLock = await navigator.wakeLock.request("screen");
          this.wakeLock.addEventListener("release", () => {
            this.wakeLock = null;
          });
        }
      } catch (err) {
        console.warn("[AudioContextManager] Wake Lock error:", err);
      }
    };

    await requestLock();
    if (!this.hasVisibilityListener) {
      document.addEventListener("visibilitychange", async () => {
        if (document.visibilityState === "visible") {
          await requestLock();
          if (this.audioContext && isAudioContextPaused(this.audioContext.state)) {
            await this.resume();
          }
        }
      });
      this.hasVisibilityListener = true;
    }
  }

  async resume(): Promise<void> {
    if (!this.audioContext) return;
    if (isAudioContextPaused(this.audioContext.state)) {
      try {
        await this.audioContext.resume();
        const state = this.audioContext.state as AudioContextState;
        console.log(`[AudioContextManager] Resumed, state: ${state}`);
        if (state === "running") {
          this.notifyStateChange("running");
        }
      } catch (error) {
        console.error("[AudioContextManager] Resume failed:", error);
        throw error;
      }
    }
  }

  async unlockAudio(): Promise<boolean> {
    const ctx = this.getContext();
    if (isAudioContextPaused(ctx.state)) {
      try {
        await ctx.resume();
        const state = ctx.state as AudioContextState;
        if (state === "running") {
          this.notifyStateChange("running");
        }
      } catch (e) {
        console.warn("[AudioContextManager] resume() on unlock failed:", e);
      }
    }

    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      source.stop(0.001);
    } catch (e) {
      console.warn("[AudioContextManager] dummy buffer on unlock failed:", e);
    }

    if (this.silentAudioElement && this.silentAudioElement.paused) {
      this.silentAudioElement.play().catch(() => {});
    }

    return !isAudioContextPaused(ctx.state);
  }

  async suspend(): Promise<void> {
    if (!this.audioContext) return;
    if (this.audioContext.state === "running") {
      try {
        await this.audioContext.suspend();
      } catch (error) {
        console.error("[AudioContextManager] Suspend failed:", error);
        throw error;
      }
    }
  }

  getState(): AudioContextState | "uninitialized" {
    return this.audioContext?.state ?? "uninitialized";
  }

  private notifyStateChange(state: AudioContextState): void {
    this.stateChangeCallbacks.forEach((cb) => {
      try {
        cb(state);
      } catch (e) {
        console.error("[AudioContextManager] State change callback error:", e);
      }
    });
  }

  onStateChange(callback: (state: AudioContextState) => void): () => void {
    this.stateChangeCallbacks.add(callback);
    return () => {
      this.stateChangeCallbacks.delete(callback);
    };
  }

  setStateChangeCallback(callback: (state: AudioContextState) => void): void {
    this.stateChangeCallbacks.add(callback);
  }

  getMasterGain(): GainNode {
    if (!this.masterGainNode) {
      const ctx = this.getContext();
      this.masterGainNode = ctx.createGain();
      this.masterGainNode.connect(ctx.destination);
    }
    return this.masterGainNode;
  }

  getOutputLatencyMs(): number {
    try {
      return (this.audioContext?.outputLatency ?? 0) * 1000;
    } catch {
      return 0;
    }
  }

  getCurrentTime(): number {
    return this.audioContext?.currentTime || 0;
  }

  private setupStateChangeListener(): void {
    if (!this.audioContext) return;
    this.audioContext.onstatechange = () => {
      const state = this.audioContext?.state;
      if (state) {
        this.notifyStateChange(state);
      }
      if (isAudioContextPaused(state)) {
        console.warn(`[AudioContextManager] AudioContext ${state} - user interaction required to resume`);
      }
    };
  }

  /**
   * Setup Audio Graph with 200Hz Frequency Splitting, 3D HRTF & Haas Speaker Widening
   */
  private setupMasterGain(): void {
    if (!this.audioContext) return;

    // DJ lowpass filter (entry node from music sources)
    this.lowPassFilterNode = this.audioContext.createBiquadFilter();
    this.lowPassFilterNode.type = "lowpass";
    this.lowPassFilterNode.frequency.value = LOW_PASS_CONSTANTS.MAX_FREQ;
    this.lowPassFilterNode.Q.value = 0.707;

    this.masterGainNode = this.audioContext.createGain();
    this.masterGainNode.gain.value = 1.0;

    // --- Fly 3D Architecture ---
    this.flyInputGain = this.audioContext.createGain();
    this.flyBypassGain = this.audioContext.createGain();
    this.flyBypassGain.gain.value = 1.0; // Fly is OFF by default -> 100% bypass

    // 1. Bass Anchor: 200Hz Lows branch (Bass & Kick stays firmly CENTER)
    this.flyBassFilter = this.audioContext.createBiquadFilter();
    this.flyBassFilter.type = "lowpass";
    this.flyBassFilter.frequency.value = 200;
    this.flyBassFilter.Q.value = 0.707;
    this.flyBassGain = this.audioContext.createGain();
    this.flyBassGain.gain.value = 0.0;

    // 2. Mids/Highs (>200Hz) branch (Vocals & Instruments fly in 3D/Stereo)
    this.flyHighFilter = this.audioContext.createBiquadFilter();
    this.flyHighFilter.type = "highpass";
    this.flyHighFilter.frequency.value = 200;
    this.flyHighFilter.Q.value = 0.707;
    this.flyHighGain = this.audioContext.createGain();
    this.flyHighGain.gain.value = 0.0;

    // 3. Headphone HRTF 3D Panner
    this.panner3D = this.audioContext.createPanner();
    this.panner3D.panningModel = "HRTF";
    this.panner3D.distanceModel = "inverse";
    this.panner3D.refDistance = 1;
    this.panner3D.maxDistance = 10000;
    this.panner3D.rolloffFactor = 1;
    this.flyHeadphonesGain = this.audioContext.createGain();
    this.flyHeadphonesGain.gain.value = 1.0;

    // 4. Stereo Panner for Speakers + Haas effect
    this.stereoPannerNode = this.audioContext.createStereoPanner();
    this.stereoPannerNode.pan.value = 0;
    this.flySpeakersGain = this.audioContext.createGain();
    this.flySpeakersGain.gain.value = 0.0;

    this.haasDelayNode = this.audioContext.createDelay(0.05);
    this.haasDelayNode.delayTime.value = 0.012; // 12ms Haas delay
    this.haasGainNode = this.audioContext.createGain();
    this.haasGainNode.gain.value = 0.16;

    // 5. Producer subtle ambience reverb
    try {
      this.ambienceConvolver = this.audioContext.createConvolver();
      this.ambienceConvolver.buffer = createAmbienceImpulse(this.audioContext, 0.5, 3.0);
      this.ambienceGain = this.audioContext.createGain();
      this.ambienceGain.gain.value = 0.08;
    } catch {}

    // 6. Analysers for real-time envelopes
    this.vocalAnalyser = this.audioContext.createAnalyser();
    this.vocalAnalyser.fftSize = 512;
    this.bassAnalyser = this.audioContext.createAnalyser();
    this.bassAnalyser.fftSize = 256;

    // --- Wire Graph ---
    this.lowPassFilterNode.connect(this.flyInputGain);

    // Bypass path
    this.flyInputGain.connect(this.flyBypassGain);
    this.flyBypassGain.connect(this.masterGainNode);

    // Bass branch: straight to masterGain (Center, never panned!)
    this.flyInputGain.connect(this.flyBassFilter);
    this.flyBassFilter.connect(this.bassAnalyser);
    this.flyBassFilter.connect(this.flyBassGain);
    this.flyBassGain.connect(this.masterGainNode);

    // High branch: into analysers & panners
    this.flyInputGain.connect(this.flyHighFilter);
    this.flyHighFilter.connect(this.vocalAnalyser);

    // Headphones path (HRTF)
    this.flyHighFilter.connect(this.panner3D);
    this.panner3D.connect(this.flyHeadphonesGain);
    this.flyHeadphonesGain.connect(this.flyHighGain);

    // Speakers path (Stereo + Haas)
    this.flyHighFilter.connect(this.stereoPannerNode);
    this.stereoPannerNode.connect(this.flySpeakersGain);
    this.stereoPannerNode.connect(this.haasDelayNode);
    this.haasDelayNode.connect(this.haasGainNode);
    this.haasGainNode.connect(this.flySpeakersGain);
    this.flySpeakersGain.connect(this.flyHighGain);

    // Ambience path
    if (this.ambienceConvolver && this.ambienceGain) {
      this.flyHighFilter.connect(this.ambienceConvolver);
      this.ambienceConvolver.connect(this.ambienceGain);
      this.ambienceGain.connect(this.flyHighGain);
    }

    this.flyHighGain.connect(this.masterGainNode);

    // Master to destination
    this.masterGainNode.connect(this.audioContext.destination);

    // Bluetooth keepalive
    const keepalive = this.audioContext.createOscillator();
    keepalive.frequency.value = 1;
    const keepaliveGain = this.audioContext.createGain();
    keepaliveGain.gain.value = 0.0001;
    keepalive.connect(keepaliveGain);
    keepaliveGain.connect(this.lowPassFilterNode);
    keepalive.start();
  }

  getInputNode(): AudioNode {
    if (!this.lowPassFilterNode) {
      this.getContext();
    }
    return this.lowPassFilterNode!;
  }

  setLowPassFreq(freq: number, rampTime?: number): void {
    if (!this.lowPassFilterNode || !this.audioContext) return;
    const clampedFreq = Math.max(LOW_PASS_CONSTANTS.MIN_FREQ, Math.min(LOW_PASS_CONSTANTS.MAX_FREQ, freq));
    if (rampTime && rampTime > 0) {
      const now = this.audioContext.currentTime;
      this.lowPassFilterNode.frequency.cancelScheduledValues(now);
      this.lowPassFilterNode.frequency.setValueAtTime(this.lowPassFilterNode.frequency.value, now);
      this.lowPassFilterNode.frequency.exponentialRampToValueAtTime(clampedFreq, now + rampTime);
    } else {
      this.lowPassFilterNode.frequency.value = clampedFreq;
    }
  }

  setMasterGain(value: number, rampTime?: number): void {
    if (!this.masterGainNode || !this.audioContext) return;
    const clampedValue = Math.max(0, Math.min(1, value));
    if (rampTime && rampTime > 0) {
      const now = this.audioContext.currentTime;
      this.masterGainNode.gain.cancelScheduledValues(now);
      this.masterGainNode.gain.setValueAtTime(this.masterGainNode.gain.value, now);
      this.masterGainNode.gain.linearRampToValueAtTime(clampedValue, now + rampTime);
    } else {
      this.masterGainNode.gain.value = clampedValue;
    }
  }

  setFlyOutputDevice(device: "headphones" | "speakers"): void {
    this.flyOutputDevice = device;
    if (!this.audioContext || !this.flyHeadphonesGain || !this.flySpeakersGain) return;
    const now = this.audioContext.currentTime;
    try {
      if (device === "headphones") {
        this.flyHeadphonesGain.gain.cancelScheduledValues(now);
        this.flyHeadphonesGain.gain.setValueAtTime(this.flyHeadphonesGain.gain.value, now);
        this.flyHeadphonesGain.gain.linearRampToValueAtTime(1.0, now + 0.03);

        this.flySpeakersGain.gain.cancelScheduledValues(now);
        this.flySpeakersGain.gain.setValueAtTime(this.flySpeakersGain.gain.value, now);
        this.flySpeakersGain.gain.linearRampToValueAtTime(0.0, now + 0.03);
      } else {
        this.flyHeadphonesGain.gain.cancelScheduledValues(now);
        this.flyHeadphonesGain.gain.setValueAtTime(this.flyHeadphonesGain.gain.value, now);
        this.flyHeadphonesGain.gain.linearRampToValueAtTime(0.0, now + 0.03);

        this.flySpeakersGain.gain.cancelScheduledValues(now);
        this.flySpeakersGain.gain.setValueAtTime(this.flySpeakersGain.gain.value, now);
        this.flySpeakersGain.gain.linearRampToValueAtTime(1.0, now + 0.03);
      }
    } catch {
      this.flyHeadphonesGain.gain.value = device === "headphones" ? 1.0 : 0.0;
      this.flySpeakersGain.gain.value = device === "speakers" ? 1.0 : 0.0;
    }
  }

  private activateFlyGraph(): void {
    if (!this.audioContext || !this.flyBypassGain || !this.flyBassGain || !this.flyHighGain) return;
    const now = this.audioContext.currentTime;
    try {
      this.flyBypassGain.gain.cancelScheduledValues(now);
      this.flyBypassGain.gain.setValueAtTime(this.flyBypassGain.gain.value, now);
      this.flyBypassGain.gain.linearRampToValueAtTime(0.0, now + 0.03);

      this.flyBassGain.gain.cancelScheduledValues(now);
      this.flyBassGain.gain.setValueAtTime(this.flyBassGain.gain.value, now);
      this.flyBassGain.gain.linearRampToValueAtTime(1.0, now + 0.03);

      this.flyHighGain.gain.cancelScheduledValues(now);
      this.flyHighGain.gain.setValueAtTime(this.flyHighGain.gain.value, now);
      this.flyHighGain.gain.linearRampToValueAtTime(1.0, now + 0.03);

      if (this.ambienceGain) {
        this.ambienceGain.gain.cancelScheduledValues(now);
        this.ambienceGain.gain.setValueAtTime(this.ambienceGain.gain.value, now);
        this.ambienceGain.gain.linearRampToValueAtTime(0.08, now + 0.03);
      }
    } catch {
      this.flyBypassGain.gain.value = 0.0;
      this.flyBassGain.gain.value = 1.0;
      this.flyHighGain.gain.value = 1.0;
      if (this.ambienceGain) this.ambienceGain.gain.value = 0.08;
    }
  }

  private deactivateFlyGraph(): void {
    if (!this.audioContext || !this.flyBypassGain || !this.flyBassGain || !this.flyHighGain) return;
    const now = this.audioContext.currentTime;
    try {
      this.flyBypassGain.gain.cancelScheduledValues(now);
      this.flyBypassGain.gain.setValueAtTime(this.flyBypassGain.gain.value, now);
      this.flyBypassGain.gain.linearRampToValueAtTime(1.0, now + 0.03);

      this.flyBassGain.gain.cancelScheduledValues(now);
      this.flyBassGain.gain.setValueAtTime(this.flyBassGain.gain.value, now);
      this.flyBassGain.gain.linearRampToValueAtTime(0.0, now + 0.03);

      this.flyHighGain.gain.cancelScheduledValues(now);
      this.flyHighGain.gain.setValueAtTime(this.flyHighGain.gain.value, now);
      this.flyHighGain.gain.linearRampToValueAtTime(0.0, now + 0.03);

      if (this.ambienceGain) {
        this.ambienceGain.gain.cancelScheduledValues(now);
        this.ambienceGain.gain.setValueAtTime(this.ambienceGain.gain.value, now);
        this.ambienceGain.gain.linearRampToValueAtTime(0.0, now + 0.03);
      }
    } catch {
      this.flyBypassGain.gain.value = 1.0;
      this.flyBassGain.gain.value = 0.0;
      this.flyHighGain.gain.value = 0.0;
      if (this.ambienceGain) this.ambienceGain.gain.value = 0.0;
    }
  }

  /** Keep Fly aligned with the exact buffer offset used by music playback. */
  setFlyTrack(buffer: AudioBuffer, startTime: number, offset: number, lyricsLines?: LrcLine[]): void {
    const currentPan = this.getCurrentFlyPan();
    this.flyRelease = null;
    this.flyTrack = {
      buffer,
      startTime,
      offset,
      lyricsLines,
    };
    if (this.flyMode === "auto") this.scheduleFlyMotion(currentPan);
  }

  setFlyLyrics(lyricsLines: LrcLine[]): void {
    if (!this.flyTrack) return;
    this.flyTrack.lyricsLines = lyricsLines;
    this.flyTrack.profile = getMusicMotionProfile(this.flyTrack.buffer, lyricsLines);
    if (this.flyMode === "auto") {
      this.scheduleFlyMotion(this.getCurrentFlyPan());
    }
  }

  clearFlyTrack(): void {
    const currentPan = this.getCurrentFlyPan();
    this.flyTrack = null;
    if (this.flyMode === "auto") {
      this.flyRelease = { pan: currentPan, startTime: this.audioContext?.currentTime ?? 0 };
      this.moveFlyPan(0, 0.25, currentPan);
    }
  }

  setFlyAuto(depth: number): void {
    this.getContext();
    const currentPan = this.getCurrentFlyPan();
    this.flyMode = "auto";
    this.flyDepth = Math.max(0, Math.min(0.85, depth));
    this.activateFlyGraph();
    this.scheduleFlyMotion(currentPan);
  }

  setFlyManual(pan: number): void {
    this.getContext();
    const currentPan = this.getCurrentFlyPan();
    this.flyMode = "manual";
    this.flyRelease = null;
    this.flyManualPan = Math.max(-0.85, Math.min(0.85, pan));
    this.activateFlyGraph();
    this.moveFlyPan(this.flyManualPan, 0.2, currentPan);
  }

  disableFly(): void {
    const currentPan = this.getCurrentFlyPan();
    this.flyMode = "off";
    this.flyRelease = null;
    this.deactivateFlyGraph();
    this.moveFlyPan(0, 0.3, currentPan);
  }

  getCurrentFlyMotion(): {
    pan: number;
    activity: number;
    elevation: number;
    depth: number;
    isLyricsSynced: boolean;
  } {
    if (this.flyMode === "manual") {
      const angle = this.flyManualPan * (Math.PI / 2.2);
      return {
        pan: this.flyManualPan,
        activity: 0,
        elevation: 0,
        depth: -2.0 * Math.cos(angle),
        isLyricsSynced: false,
      };
    }
    const track = this.flyTrack;
    if (this.flyMode !== "auto" || !this.audioContext) {
      return { pan: 0, activity: 0, elevation: 0, depth: -2, isLyricsSynced: false };
    }
    if (!track) {
      const release = this.flyRelease;
      const remaining = release ? Math.max(0, 1 - (this.audioContext.currentTime - release.startTime) / 0.25) : 0;
      return {
        pan: (release?.pan ?? 0) * remaining,
        activity: 0,
        elevation: 0,
        depth: -2,
        isLyricsSynced: false,
      };
    }
    const profile = (track.profile ??= getMusicMotionProfile(track.buffer, track.lyricsLines));
    if (!profile) return { pan: 0, activity: 0, elevation: 0, depth: -2, isLyricsSynced: false };
    const trackTime = track.offset + Math.max(0, this.audioContext.currentTime - track.startTime);
    if (trackTime >= profile.duration || this.audioContext.currentTime < track.startTime) {
      return { pan: 0, activity: 0, elevation: 0, depth: -2, isLyricsSynced: false };
    }
    const motion = sampleMusicMotion(profile, trackTime);
    return {
      pan: motion.pan * this.flyDepth,
      activity: motion.activity,
      elevation: motion.elevation * this.flyDepth,
      depth: motion.depth,
      isLyricsSynced: motion.isLyricsSynced,
    };
  }

  getCurrentFlyPan(): number {
    return this.getCurrentFlyMotion().pan;
  }

  private resetStereoPanner(targetPan = 0): StereoPannerNode | null {
    if (!this.audioContext || !this.lowPassFilterNode || !this.masterGainNode) return null;
    try {
      const replacement = this.audioContext.createStereoPanner();
      replacement.pan.value = targetPan;

      if (this.flySpeakersGain && this.flyHighFilter) {
        replacement.connect(this.flySpeakersGain);
        this.flyHighFilter.connect(replacement);
        if (this.stereoPannerNode) {
          try {
            this.flyHighFilter.disconnect(this.stereoPannerNode);
          } catch {}
          try {
            this.stereoPannerNode.disconnect();
          } catch {}
        }
      } else {
        replacement.connect(this.masterGainNode);
        this.lowPassFilterNode.connect(replacement);
        if (this.stereoPannerNode) {
          try {
            this.lowPassFilterNode.disconnect(this.stereoPannerNode);
          } catch {}
          try {
            this.stereoPannerNode.disconnect();
          } catch {}
        }
      }

      this.stereoPannerNode = replacement;
      return this.stereoPannerNode;
    } catch (error) {
      console.warn("[Fly] Could not reset StereoPannerNode", error);
      return null;
    }
  }

  private updatePanner3DPosition(x: number, y: number, z: number, duration = 0.05): void {
    if (!this.panner3D || !this.audioContext) return;
    const now = this.audioContext.currentTime;
    try {
      if (this.panner3D.positionX && typeof this.panner3D.positionX.setValueAtTime === "function") {
        this.panner3D.positionX.cancelScheduledValues(now);
        this.panner3D.positionX.setValueAtTime(this.panner3D.positionX.value, now);
        this.panner3D.positionX.linearRampToValueAtTime(x, now + duration);

        this.panner3D.positionY.cancelScheduledValues(now);
        this.panner3D.positionY.setValueAtTime(this.panner3D.positionY.value, now);
        this.panner3D.positionY.linearRampToValueAtTime(y, now + duration);

        this.panner3D.positionZ.cancelScheduledValues(now);
        this.panner3D.positionZ.setValueAtTime(this.panner3D.positionZ.value, now);
        this.panner3D.positionZ.linearRampToValueAtTime(z, now + duration);
      } else if (typeof this.panner3D.setPosition === "function") {
        this.panner3D.setPosition(x, y, z);
      }
    } catch {
      if (typeof this.panner3D.setPosition === "function") {
        try {
          this.panner3D.setPosition(x, y, z);
        } catch {}
      }
    }
  }

  private moveFlyPan(target: number, duration: number, currentPan: number): void {
    if (!this.audioContext || !this.stereoPannerNode) return;
    const now = this.audioContext.currentTime;

    // 1. Stereo Panner automation
    try {
      const pan = this.stereoPannerNode.pan;
      pan.cancelScheduledValues(0);
      pan.setValueAtTime(currentPan, now);
      pan.linearRampToValueAtTime(target, now + duration);
    } catch {
      const panner = this.resetStereoPanner(currentPan);
      if (panner) {
        try {
          const pan = panner.pan;
          pan.setValueAtTime(currentPan, now);
          pan.linearRampToValueAtTime(target, now + duration);
        } catch {
          try {
            panner.pan.value = target;
          } catch (error) {
            console.warn("[Fly] Could not reset pan", error);
          }
        }
      }
    }

    // 2. 3D HRTF Panner coordinates
    const angle = target * (Math.PI / 2.2);
    const radius = 2.0;
    const x = Math.sin(angle) * radius;
    const z = -Math.cos(angle) * radius;
    this.updatePanner3DPosition(x, 0, z, duration);
  }

  private scheduleFlyMotion(currentPan: number): void {
    if (!this.audioContext || !this.stereoPannerNode) return;
    try {
      const track = this.flyTrack;
      if (!track || this.flyDepth === 0) {
        this.moveFlyPan(0, 0.2, currentPan);
        return;
      }

      const profile = (track.profile ??= getMusicMotionProfile(track.buffer, track.lyricsLines));

      const now = this.audioContext.currentTime;
      const startAt = Math.max(now + 0.03, track.startTime);
      const trackTime = track.offset + Math.max(0, startAt - track.startTime);
      const remaining = profile.duration - trackTime;
      if (remaining <= 0.01) {
        this.moveFlyPan(0, 0.2, currentPan);
        return;
      }

      const count = Math.max(2, Math.ceil(remaining / profile.stepSeconds) + 1);
      const curve = new Float32Array(count);
      const curveX = new Float32Array(count);
      const curveY = new Float32Array(count);
      const curveZ = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        const position = trackTime + (remaining * i) / (count - 1);
        const sample = sampleMusicMotion(profile, position);
        const rawPan = sample.pan * this.flyDepth;
        curve[i] = rawPan;

        const angle = rawPan * (Math.PI / 2.2);
        curveX[i] = Math.sin(angle) * 2.0;
        curveZ[i] = -Math.cos(angle) * 2.0;
        curveY[i] = sample.elevation * this.flyDepth;
      }

      let scheduled = false;
      const pan = this.stereoPannerNode.pan;

      try {
        pan.cancelScheduledValues(0);
        pan.setValueAtTime(currentPan, now);
        pan.linearRampToValueAtTime(curve[0], startAt);
        pan.setValueCurveAtTime(curve, startAt, remaining);
        scheduled = true;
      } catch {
        const panner = this.resetStereoPanner(currentPan);
        if (panner) {
          try {
            const newPan = panner.pan;
            newPan.setValueAtTime(currentPan, now);
            newPan.linearRampToValueAtTime(curve[0], startAt);
            newPan.setValueCurveAtTime(curve, startAt, remaining);
            scheduled = true;
          } catch (innerError) {
            console.warn("[Fly] Failed to schedule curve on new panner", innerError);
          }
        }
      }

      // Schedule 3D HRTF coordinates curve if supported
      if (this.panner3D?.positionX && typeof this.panner3D.positionX.setValueCurveAtTime === "function") {
        try {
          this.panner3D.positionX.cancelScheduledValues(0);
          this.panner3D.positionX.setValueAtTime(this.panner3D.positionX.value, now);
          this.panner3D.positionX.linearRampToValueAtTime(curveX[0], startAt);
          this.panner3D.positionX.setValueCurveAtTime(curveX, startAt, remaining);

          this.panner3D.positionY.cancelScheduledValues(0);
          this.panner3D.positionY.setValueAtTime(this.panner3D.positionY.value, now);
          this.panner3D.positionY.linearRampToValueAtTime(curveY[0], startAt);
          this.panner3D.positionY.setValueCurveAtTime(curveY, startAt, remaining);

          this.panner3D.positionZ.cancelScheduledValues(0);
          this.panner3D.positionZ.setValueAtTime(this.panner3D.positionZ.value, now);
          this.panner3D.positionZ.linearRampToValueAtTime(curveZ[0], startAt);
          this.panner3D.positionZ.setValueCurveAtTime(curveZ, startAt, remaining);
        } catch {
          this.updatePanner3DPosition(curveX[0], curveY[0], curveZ[0], 0.2);
        }
      }

      if (!scheduled) {
        this.moveFlyPan(curve[0] ?? 0, 0.2, currentPan);
      }
    } catch (error) {
      console.warn("[Fly] Could not schedule music-driven motion", error);
      this.flyMode = "off";
      try {
        this.resetStereoPanner(0);
      } catch {}
    }
  }

  async setOutputDevice(deviceId: string): Promise<boolean> {
    const context = this.getContext() as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };
    if (!context.setSinkId) return false;
    await context.setSinkId(deviceId === "default" ? "" : deviceId);
    return true;
  }

  perfTimeToAudioTime(perfTimeMs: number): number {
    const ctx = this.audioContext;
    if (!ctx) return perfTimeMs / 1000;
    const ts = ctx.getOutputTimestamp();
    if (!ts.contextTime || !ts.performanceTime) {
      return ctx.currentTime + (perfTimeMs - performance.now()) / 1000;
    }
    return ts.contextTime + (perfTimeMs - ts.performanceTime) / 1000;
  }

  isReady(): boolean {
    return this.audioContext?.state === "running";
  }

  async decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.getContext();
    return await ctx.decodeAudioData(arrayBuffer);
  }

  createBufferSource(): AudioBufferSourceNode {
    const ctx = this.getContext();
    return ctx.createBufferSource();
  }
}

export const audioContextManager = AudioContextManager.getInstance();
export { AudioContextManager };
