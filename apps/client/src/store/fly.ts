import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type FlyMode = "auto" | "manual";

interface FlyState {
  enabled: boolean;
  mode: FlyMode;
  width: number;
  cycleSeconds: number;
  manualPan: number;
  currentPan: number;
  setEnabled: (enabled: boolean) => void;
  setMode: (mode: FlyMode) => void;
  setWidth: (width: number) => void;
  setCycleSeconds: (seconds: number) => void;
  setManualPan: (pan: number) => void;
  setCurrentPan: (pan: number) => void;
}

export const useFlyStore = create<FlyState>()(
  persist(
    (set) => ({
      enabled: false,
      mode: "auto",
      width: 0.85,
      cycleSeconds: 6,
      manualPan: 0,
      currentPan: 0,
      setEnabled: (enabled) => set({ enabled }),
      setMode: (mode) => set({ mode }),
      setWidth: (width) => set({ width: Math.max(0, Math.min(1, width)) }),
      setCycleSeconds: (cycleSeconds) => set({ cycleSeconds: Math.max(2, Math.min(16, cycleSeconds)) }),
      setManualPan: (manualPan) => set({ manualPan: Math.max(-1, Math.min(1, manualPan)) }),
      setCurrentPan: (currentPan) => set({ currentPan }),
    }),
    {
      name: "beatsync-fly-audio",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ enabled, mode, width, cycleSeconds, manualPan }) => ({
        enabled,
        mode,
        width,
        cycleSeconds,
        manualPan,
      }),
    }
  )
);
