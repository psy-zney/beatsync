import { useCallback, useEffect, useRef } from "react";
import { useGlobalStore } from "@/store/global";
import { calculateNextProbeDelay } from "@/utils/ntp";

export const useNtpHeartbeat = () => {
  const ntpTimerRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const sendProbePair = useGlobalStore((state) => state.sendProbePair);

  const scheduleRef = useRef<(immediate?: boolean) => void>(() => {});

  const scheduleNextNtpRequest = useCallback(
    (immediate = false) => {
      if (ntpTimerRef.current) {
        clearTimeout(ntpTimerRef.current);
      }
      if (!isRunningRef.current) return;

      const currentMeasurements = useGlobalStore.getState().syncMeasurements;
      const interval = immediate
        ? 0
        : calculateNextProbeDelay({
            measurementCount: currentMeasurements.length,
            isPageHidden: typeof document !== "undefined" && document.hidden,
          });

      ntpTimerRef.current = window.setTimeout(() => {
        if (!isRunningRef.current) return;
        try {
          sendProbePair();
        } finally {
          scheduleRef.current();
        }
      }, interval);
    },
    [sendProbePair]
  );

  // Keep scheduleRef in sync with the latest callback via useEffect
  useEffect(() => {
    scheduleRef.current = scheduleNextNtpRequest;
  }, [scheduleNextNtpRequest]);

  const startHeartbeat = useCallback(() => {
    isRunningRef.current = true;
    scheduleNextNtpRequest(true);
  }, [scheduleNextNtpRequest]);

  const stopHeartbeat = useCallback(() => {
    isRunningRef.current = false;
    if (ntpTimerRef.current) {
      clearTimeout(ntpTimerRef.current);
      ntpTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!isRunningRef.current) return;
      // Refresh immediately when the user returns; while hidden, reschedule
      // with the cheaper background interval.
      scheduleRef.current(!document.hidden);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopHeartbeat();
    };
  }, [stopHeartbeat]);

  return {
    startHeartbeat,
    stopHeartbeat,
  };
};
