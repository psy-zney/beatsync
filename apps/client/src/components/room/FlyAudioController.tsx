"use client";

import { audioContextManager } from "@/lib/audioContextManager";
import { useFlyStore } from "@/store/fly";
import { useEffect } from "react";

const MAX_FLY_PAN = 0.85;

export const FlyAudioController = () => {
  const enabled = useFlyStore((state) => state.enabled);
  const mode = useFlyStore((state) => state.mode);
  const outputDevice = useFlyStore((state) => state.outputDevice);
  const width = useFlyStore((state) => state.width);
  const manualPan = useFlyStore((state) => state.manualPan);

  // Sync output mode (Headphones HRTF vs Speakers Wide Stereo)
  useEffect(() => {
    audioContextManager.setFlyOutputDevice(outputDevice);
  }, [outputDevice]);

  // Music-driven pan & 3D spatial automation runs on the Web Audio rendering timeline.
  useEffect(() => {
    if (!enabled) {
      audioContextManager.disableFly();
      useFlyStore.getState().setCurrentMotion(0, 0, 0, -2, false);
      return;
    }

    audioContextManager.getContext();
    void audioContextManager.resume().catch(() => {});
    audioContextManager.setFlyOutputDevice(outputDevice);

    if (mode === "auto") {
      audioContextManager.setFlyAuto(width * MAX_FLY_PAN);
    } else {
      audioContextManager.setFlyManual(manualPan * width * MAX_FLY_PAN);
    }
  }, [enabled, manualPan, mode, outputDevice, width]);

  // requestAnimationFrame is visual-only. Web Audio plays the analysed track
  // curve independently, including when background tabs throttle rendering.
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    let lastUpdate = 0;

    const tick = (now: number) => {
      if (now - lastUpdate >= 33) {
        const motion = audioContextManager.getCurrentFlyMotion();
        useFlyStore
          .getState()
          .setCurrentMotion(motion.pan, motion.activity, motion.elevation, motion.depth, motion.isLyricsSynced);
        lastUpdate = now;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  return null;
};
