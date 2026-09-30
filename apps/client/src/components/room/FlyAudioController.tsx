"use client";

import { audioContextManager } from "@/lib/audioContextManager";
import { useFlyStore } from "@/store/fly";
import { useEffect } from "react";

const MAX_FLY_PAN = 0.8;

export const FlyAudioController = () => {
  const enabled = useFlyStore((state) => state.enabled);
  const mode = useFlyStore((state) => state.mode);
  const width = useFlyStore((state) => state.width);
  const manualPan = useFlyStore((state) => state.manualPan);

  // Music-driven pan automation runs on the Web Audio rendering timeline.
  useEffect(() => {
    if (!enabled) {
      audioContextManager.disableFly();
      useFlyStore.getState().setCurrentMotion(0, 0);
      return;
    }

    audioContextManager.getContext();
    void audioContextManager.resume().catch(() => {});

    if (mode === "auto") {
      audioContextManager.setFlyAuto(width * MAX_FLY_PAN);
    } else {
      audioContextManager.setFlyManual(manualPan * width * MAX_FLY_PAN);
    }
  }, [enabled, manualPan, mode, width]);

  // requestAnimationFrame is visual-only. Web Audio plays the analysed track
  // curve independently, including when background tabs throttle rendering.
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    let lastUpdate = 0;

    const tick = (now: number) => {
      if (now - lastUpdate >= 33) {
        const motion = audioContextManager.getCurrentFlyMotion();
        useFlyStore.getState().setCurrentMotion(motion.pan, motion.activity);
        lastUpdate = now;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  return null;
};
