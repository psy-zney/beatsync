import { describe, expect, it, mock } from "bun:test";
import { AudioContextManager } from "../audioContextManager";

const makePan = () => ({
  value: 0,
  cancelScheduledValues: mock<(time: number) => void>(() => {}),
  setValueAtTime: mock<(value: number, time: number) => void>(() => {}),
  linearRampToValueAtTime: mock<(value: number, time: number) => void>(() => {}),
});

const makeManager = () => {
  const original = { pan: makePan(), disconnect: mock(() => {}) };
  const replacement = { pan: makePan(), connect: mock<(node: unknown) => void>(() => {}) };
  const context = { currentTime: 5, createStereoPanner: mock(() => replacement) };
  const filter = {
    connect: mock<(node: unknown) => void>(() => {}),
    disconnect: mock<(node: unknown) => void>(() => {}),
  };
  const gain = {};
  // Isolate each manager without creating a browser AudioContext in unit tests.
  const manager = new (AudioContextManager as unknown as { new (): AudioContextManager })();
  Object.assign(manager, {
    audioContext: context,
    stereoPannerNode: original,
    lowPassFilterNode: filter,
    masterGainNode: gain,
    flyMode: "auto",
  });
  return { manager, original, replacement, context, filter, gain };
};

describe("Fly pan automation", () => {
  it("keeps the existing panner on the standard Chromium path", () => {
    const { manager, original, context, filter } = makeManager();
    manager.clearFlyTrack();
    manager.disableFly();
    expect(original.pan.cancelScheduledValues.mock.calls).toEqual([[0], [0]]);
    expect(original.pan.setValueAtTime.mock.calls).toEqual([
      [0, 5],
      [0, 5],
    ]);
    expect(original.pan.linearRampToValueAtTime.mock.calls).toEqual([
      [0, 5.25],
      [0, 5.3],
    ]);
    expect(context.createStereoPanner).not.toHaveBeenCalled();
    expect(filter.disconnect).not.toHaveBeenCalled();
  });

  it("replaces a panner with conflicting curve events and reconnects the audio graph", () => {
    const { manager, original, replacement, context, filter, gain } = makeManager();
    original.pan.setValueAtTime.mockImplementation(() => {
      throw new DOMException("Can't add events during a curve event", "NotSupportedError");
    });
    expect(() => manager.clearFlyTrack()).not.toThrow();
    expect(context.createStereoPanner).toHaveBeenCalledTimes(1);
    expect(filter.connect).toHaveBeenCalledWith(replacement);
    expect(replacement.connect).toHaveBeenCalledWith(gain);
    expect(filter.disconnect).toHaveBeenCalledWith(original);
    expect(original.disconnect).toHaveBeenCalledTimes(1);
    expect(replacement.pan.linearRampToValueAtTime).toHaveBeenCalledWith(0, 5.25);
  });

  it("preserves music routing if replacement creation fails", () => {
    const { manager, original, context, filter } = makeManager();
    original.pan.cancelScheduledValues.mockImplementation(() => {
      throw new Error("curve conflict");
    });
    context.createStereoPanner.mockImplementation(() => {
      throw new Error("creation failed");
    });
    expect(() => manager.disableFly()).not.toThrow();
    expect(filter.disconnect).not.toHaveBeenCalled();
    expect(original.disconnect).not.toHaveBeenCalled();
  });

  it("contains errors even if replacement automation and direct pan assignment fail", () => {
    const { manager, original, replacement } = makeManager();
    original.pan.cancelScheduledValues.mockImplementation(() => {
      throw new Error("curve conflict");
    });
    replacement.pan.setValueAtTime.mockImplementation(() => {
      Object.defineProperty(replacement.pan, "value", {
        set: () => {
          throw new Error("assignment failed");
        },
      });
      throw new Error("automation failed");
    });
    expect(() => manager.disableFly()).not.toThrow();
  });

  it("switches output device between headphones and speakers cleanly", () => {
    const { manager } = makeManager();
    const hpGain = {
      gain: {
        cancelScheduledValues: mock(() => {}),
        setValueAtTime: mock(() => {}),
        linearRampToValueAtTime: mock(() => {}),
        value: 1,
      },
    };
    const spkGain = {
      gain: {
        cancelScheduledValues: mock(() => {}),
        setValueAtTime: mock(() => {}),
        linearRampToValueAtTime: mock(() => {}),
        value: 0,
      },
    };
    Object.assign(manager, { flyHeadphonesGain: hpGain, flySpeakersGain: spkGain });

    expect(() => manager.setFlyOutputDevice("speakers")).not.toThrow();
    expect(spkGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 5.03);
    expect(hpGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 5.03);

    expect(() => manager.setFlyOutputDevice("headphones")).not.toThrow();
    expect(hpGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 5.03);
    expect(spkGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 5.03);
  });
});
