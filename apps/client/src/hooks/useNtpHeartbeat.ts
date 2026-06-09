import { useCallback, useEffect, useRef } from "react";
import { useGlobalStore, MAX_NTP_MEASUREMENTS } from "@/store/global";
import { NTP_CONSTANTS } from "@beatsync/shared";

interface UseNtpHeartbeatProps {
  onConnectionStale?: () => void;
}

export const useNtpHeartbeat = ({ onConnectionStale }: UseNtpHeartbeatProps) => {
  const ntpTimerRef = useRef<number | null>(null);
  const lastNtpRequestTime = useRef<number | null>(null);
  const consecutiveTimeoutsRef = useRef(0);
  const sendProbePair = useGlobalStore((state) => state.sendProbePair);

  // Store the schedule function in a ref to allow self-referencing without
  // declaring a variable before its useCallback definition
  const scheduleRef = useRef<() => void>(() => {});

  // Schedule next NTP request
  const scheduleNextNtpRequest = useCallback(() => {
    // Cancel any existing timeout
    if (ntpTimerRef.current) {
      clearTimeout(ntpTimerRef.current);
    }

    // Determine interval based on whether we have initial measurements
    const currentMeasurements = useGlobalStore.getState().syncMeasurements;
    const interval =
      currentMeasurements.length < MAX_NTP_MEASUREMENTS
        ? NTP_CONSTANTS.INITIAL_INTERVAL_MS
        : NTP_CONSTANTS.STEADY_STATE_INTERVAL_MS;

    ntpTimerRef.current = window.setTimeout(() => {
      // Check if we have a pending request that timed out BEFORE resetting timer
      if (lastNtpRequestTime.current && Date.now() - lastNtpRequestTime.current > NTP_CONSTANTS.RESPONSE_TIMEOUT_MS) {
        const lastMessageReceivedTime = useGlobalStore.getState().lastMessageReceivedTime;
        const recentlyHeardFromServer =
          lastMessageReceivedTime !== null && Date.now() - lastMessageReceivedTime <= NTP_CONSTANTS.RESPONSE_TIMEOUT_MS;

        if (!recentlyHeardFromServer) {
          consecutiveTimeoutsRef.current += 1;

          if (consecutiveTimeoutsRef.current >= 2) {
            console.error("NTP heartbeat timed out twice without any inbound server message");
            onConnectionStale?.();
            return;
          }
        } else {
          consecutiveTimeoutsRef.current = 0;
        }

        lastNtpRequestTime.current = null;
      }

      // Only reset timer and send request if the previous one didn't timeout
      lastNtpRequestTime.current = Date.now();
      sendProbePair();
      scheduleRef.current(); // Schedule the next one via ref
    }, interval);
  }, [sendProbePair, onConnectionStale]);

  // Keep scheduleRef in sync with the latest callback via useEffect
  useEffect(() => {
    scheduleRef.current = scheduleNextNtpRequest;
  }, [scheduleNextNtpRequest]);

  // Start the heartbeat when socket opens
  const startHeartbeat = useCallback(() => {
    scheduleNextNtpRequest();
  }, [scheduleNextNtpRequest]);

  // Stop the heartbeat
  const stopHeartbeat = useCallback(() => {
    if (ntpTimerRef.current) {
      clearTimeout(ntpTimerRef.current);
      ntpTimerRef.current = null;
    }
    lastNtpRequestTime.current = null;
    consecutiveTimeoutsRef.current = 0;
  }, []);

  // Mark that we received an NTP response
  const markNTPResponseReceived = useCallback(() => {
    lastNtpRequestTime.current = null;
    consecutiveTimeoutsRef.current = 0;
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
    markNTPResponseReceived,
  };
};
