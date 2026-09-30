import { describe, expect, it } from "bun:test";
import { buildMusicMotionProfile, sampleMusicMotion, type MusicMotionBuffer } from "../musicMotion";

const SAMPLE_RATE = 8_000;

const makeTrack = (duration: number, sample: (time: number) => number): MusicMotionBuffer => {
  const data = Float32Array.from({ length: duration * SAMPLE_RATE }, (_, i) => sample(i / SAMPLE_RATE));
  return { duration, length: data.length, sampleRate: SAMPLE_RATE, getChannelData: () => data };
};

describe("music-driven Fly motion", () => {
  it("does not reverse on a fixed timer when the sound is steady", () => {
    const track = makeTrack(16, (time) => 0.35 * Math.sin(2 * Math.PI * 220 * time));
    const profile = buildMusicMotionProfile(track);

    expect(profile.boundaries.filter((time) => time > 2 && time < 14)).toHaveLength(0);
    expect(sampleMusicMotion(profile, 8).activity).toBeGreaterThan(0.2);
    expect(Math.sign(sampleMusicMotion(profile, 3).pan)).toBe(Math.sign(sampleMusicMotion(profile, 12).pan));
  });

  it("responds to distinct phrases and settles during a quiet break", () => {
    const track = makeTrack(18, (time) => {
      if ((time >= 5 && time < 6) || (time >= 11 && time < 12)) return 0;
      const frequency = time < 6 ? 180 : time < 12 ? 700 : 280;
      return 0.4 * Math.sin(2 * Math.PI * frequency * time);
    });
    const profile = buildMusicMotionProfile(track);

    expect(profile.boundaries.some((time) => Math.abs(time - 6) < 0.5)).toBe(true);
    expect(profile.boundaries.some((time) => Math.abs(time - 12) < 0.5)).toBe(true);
    expect(Math.abs(sampleMusicMotion(profile, 5.7).pan)).toBeLessThan(0.15);
    expect(sampleMusicMotion(profile, 5.7).activity).toBeLessThan(0.05);
    expect(Math.sign(sampleMusicMotion(profile, 3).pan)).not.toBe(Math.sign(sampleMusicMotion(profile, 8).pan));
    expect(Math.sign(sampleMusicMotion(profile, 8).pan)).not.toBe(Math.sign(sampleMusicMotion(profile, 14).pan));
  });

  it("samples the same motion when playback seeks to an offset", () => {
    const track = makeTrack(8, (time) => (time < 4 ? 0 : 0.4 * Math.sin(2 * Math.PI * 440 * time)));
    const profile = buildMusicMotionProfile(track);

    expect(sampleMusicMotion(profile, 4.5).activity).toBeGreaterThan(sampleMusicMotion(profile, 3.5).activity);
    expect(sampleMusicMotion(profile, -100)).toEqual(sampleMusicMotion(profile, 0));
    expect(sampleMusicMotion(profile, 1_000)).toEqual(sampleMusicMotion(profile, profile.duration));
  });

  it("detects music present only in the right stereo channel", () => {
    const right = makeTrack(8, (time) => 0.4 * Math.sin(2 * Math.PI * 440 * time)).getChannelData(0);
    const left = new Float32Array(right.length);
    const profile = buildMusicMotionProfile({
      duration: 8,
      length: right.length,
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 2,
      getChannelData: (channel) => (channel === 0 ? left : right),
    });

    expect(sampleMusicMotion(profile, 4).activity).toBeGreaterThan(0.2);
  });
});
