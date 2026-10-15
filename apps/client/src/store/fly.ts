import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type FlyMode = "auto" | "manual";
export type FlyOutputDevice = "headphones" | "speakers";

interface FlyState {
  enabled: boolean;
  mode: FlyMode;
  outputDevice: FlyOutputDevice;
  width: number;
  manualPan: number;
  currentPan: number;
  currentActivity: number;
  currentElevation: number;
  currentDepth: number;
  isLyricsSynced: boolean;
  setEnabled: (enabled: boolean) => void;
  setMode: (mode: FlyMode) => void;
  setOutputDevice: (outputDevice: FlyOutputDevice) => void;
  setWidth: (width: number) => void;
  setManualPan: (pan: number) => void;
  setCurrentMotion: (
    pan: number,
    activity: number,
    elevation?: number,
    depth?: number,
    isLyricsSynced?: boolean
  ) => void;
}

export const useFlyStore = create<FlyState>()(
  persist(
    (set) => ({
      enabled: false,
      mode: "auto",
      outputDevice: "headphones",
      width: 0.8,
      manualPan: 0,
      currentPan: 0,
      currentActivity: 0,
      currentElevation: 0,
      currentDepth: -2,
      isLyricsSynced: false,
      setEnabled: (enabled) => set({ enabled }),
      setMode: (mode) => set({ mode }),
      setOutputDevice: (outputDevice) => set({ outputDevice }),
      setWidth: (width) => set({ width: Math.max(0, Math.min(1, width)) }),
      setManualPan: (manualPan) => set({ manualPan: Math.max(-1, Math.min(1, manualPan)) }),
      setCurrentMotion: (
        currentPan,
        currentActivity,
        currentElevation = 0,
        currentDepth = -2,
        isLyricsSynced = false
      ) =>
        set({
          currentPan,
          currentActivity,
          currentElevation,
          currentDepth,
          isLyricsSynced,
        }),
    }),
    {
      name: "beatsync-fly-audio",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ enabled, mode, outputDevice, width, manualPan }) => ({
        enabled,
        mode,
        outputDevice,
        width,
        manualPan,
      }),
    }
  )
);
