import { afterAll, describe, expect, it } from "bun:test";
import { setWebAudioSessionType } from "../audioSession";

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

afterAll(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
});

describe("Safari voice audio session", () => {
  it("changes playback-only mode before microphone capture and restores it after mute", () => {
    const audioSession = { type: "playback" };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { audioSession },
    });

    setWebAudioSessionType("play-and-record");
    expect(audioSession.type).toBe("play-and-record");

    setWebAudioSessionType("playback");
    expect(audioSession.type).toBe("playback");
  });

  it("does not fail on browsers without the AudioSession API", () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    expect(() => setWebAudioSessionType("play-and-record")).not.toThrow();
  });
});
