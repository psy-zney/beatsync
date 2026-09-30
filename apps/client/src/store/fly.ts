import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type FlyMode = "auto" | "manual";

interface FlyState {
  enabled: boolean;
  mode: FlyMode;
  width: number;
  manualPan: number;
  currentPan: number;
  currentActivity: number;
  setEnabled: (enabled: boolean) => void;
  setMode: (mode: FlyMode) => void;
  setWidth: (width: number) => void;
  setManualPan: (pan: number) => void;
  setCurrentMotion: (pan: number, activity: number) => void;
}

export const useFlyStore = create<FlyState>()(
  persist(
    (set) => ({
      enabled: false,
      mode: "auto",
      width: 0.8,
      manualPan: 0,
      currentPan: 0,
      currentActivity: 0,
      setEnabled: (enabled) => set({ enabled }),
      setMode: (mode) => set({ mode }),
      setWidth: (width) => set({ width: Math.max(0, Math.min(1, width)) }),
      setManualPan: (manualPan) => set({ manualPan: Math.max(-1, Math.min(1, manualPan)) }),
      setCurrentMotion: (currentPan, currentActivity) => set({ currentPan, currentActivity }),
    }),
    {
      name: "beatsync-fly-audio",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ enabled, mode, width, manualPan }) => ({
        enabled,
        mode,
        width,
        manualPan,
      }),
    }
  )
);
