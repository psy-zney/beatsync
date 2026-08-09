"use client";

import { audioContextManager } from "@/lib/audioContextManager";
import { useFlyStore } from "@/store/fly";
import { useEffect } from "react";

// Never mute the opposite ear completely. At the maximum setting the Web
// Audio equal-power panner still leaves a quiet bed in the other channel.
const MAX_FLY_PAN = 0.8;
const PAN_SMOOTHING_SECONDS = 0.16;

export const FlyAudioController = () => {
  const enabled = useFlyStore((state) => state.enabled);

  useEffect(() => {
    let frame = 0;
    let lastVisualUpdate = 0;
    let lastFrameTime = performance.now();
    let phase = 0;
    let appliedPan = useFlyStore.getState().currentPan;
    const setCurrentPan = useFlyStore.getState().setCurrentPan;

    if (!enabled) {
      audioContextManager.setStereoPan(0, 0.35);
      setCurrentPan(0);
      return;
    }

    audioContextManager.getContext();
    void audioContextManager.resume().catch(() => {});

    const tick = (now: number) => {
      const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05);
      lastFrameTime = now;

      const { mode, width, cycleSeconds, manualPan } = useFlyStore.getState();
      let targetPan: number;

      if (mode === "auto") {
        phase = (phase + deltaSeconds / cycleSeconds) % 1;
        // asin(sin()) is a triangle wave: both directions move at the same,
        // steady rate instead of accelerating sharply through the center.
        const linearSweep = (2 / Math.PI) * Math.asin(Math.sin(phase * Math.PI * 2));
        targetPan = linearSweep * width * MAX_FLY_PAN;
      } else {
        targetPan = manualPan * width * MAX_FLY_PAN;
      }

      // Smooth setting changes and direction reversals without desynchronizing
      // the animation: currentPan is the exact value sent to the audio graph.
      const smoothing = 1 - Math.exp(-deltaSeconds / PAN_SMOOTHING_SECONDS);
      appliedPan += (targetPan - appliedPan) * smoothing;
      audioContextManager.setStereoPan(appliedPan);

      if (now - lastVisualUpdate >= 33) {
        setCurrentPan(appliedPan);
        lastVisualUpdate = now;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  return null;
};
