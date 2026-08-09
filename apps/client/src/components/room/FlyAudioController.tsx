"use client";

import { audioContextManager } from "@/lib/audioContextManager";
import { useFlyStore } from "@/store/fly";
import { useEffect } from "react";

export const FlyAudioController = () => {
  const enabled = useFlyStore((state) => state.enabled);
  const mode = useFlyStore((state) => state.mode);
  const width = useFlyStore((state) => state.width);
  const cycleSeconds = useFlyStore((state) => state.cycleSeconds);
  const manualPan = useFlyStore((state) => state.manualPan);

  useEffect(() => {
    let frame = 0;
    let lastVisualUpdate = 0;
    const setCurrentPan = useFlyStore.getState().setCurrentPan;

    if (!enabled) {
      audioContextManager.setStereoPan(0, 0.2);
      setCurrentPan(0);
      return;
    }

    audioContextManager.getContext();
    void audioContextManager.resume().catch(() => {});

    if (mode === "manual") {
      const pan = manualPan * width;
      audioContextManager.setStereoPan(pan, 0.12);
      setCurrentPan(pan);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const phase = ((now - start) / 1000 / cycleSeconds) * Math.PI * 2;
      const pan = Math.sin(phase) * width;
      audioContextManager.setStereoPan(pan);
      if (now - lastVisualUpdate >= 33) {
        setCurrentPan(pan);
        lastVisualUpdate = now;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cycleSeconds, enabled, manualPan, mode, width]);

  return null;
};
