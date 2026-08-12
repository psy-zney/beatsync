"use client";

import { extractFileNameFromUrl } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { useEffect, useMemo } from "react";

const MEDIA_SESSION_ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "seekbackward",
  "seekforward",
  "seekto",
  "nexttrack",
  "previoustrack",
];

const seekTo = (position: number) => {
  const state = useGlobalStore.getState();
  const nextPosition = Math.max(0, Math.min(position, state.duration || position));
  if (state.isPlaying) {
    state.broadcastPlay(nextPosition);
  } else {
    useGlobalStore.setState({ currentTime: nextPosition });
  }
};

/** Exposes synchronized Web Audio playback to iOS lock-screen controls. */
export const MediaSessionController = () => {
  const roomId = useRoomStore((state) => state.roomId);
  const selectedAudioUrl = useGlobalStore((state) => state.selectedAudioUrl);
  const audioSources = useGlobalStore((state) => state.audioSources);
  const isPlaying = useGlobalStore((state) => state.isPlaying);
  const duration = useGlobalStore((state) => state.duration);

  const selectedSource = useMemo(
    () => audioSources.find((source) => source.source.url === selectedAudioUrl)?.source,
    [audioSources, selectedAudioUrl]
  );

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.metadata = selectedSource
      ? new MediaMetadata({
          title: selectedSource.title?.trim() || extractFileNameFromUrl(selectedSource.url),
          artist: "BeatSync",
          album: roomId ? `Room ${roomId}` : "Synchronized listening",
          artwork: [{ src: "/account.png", type: "image/png" }],
        })
      : null;
  }, [roomId, selectedSource]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => {
        const state = useGlobalStore.getState();
        if (!state.isPlaying) state.broadcastPlay();
      },
      pause: () => {
        const state = useGlobalStore.getState();
        if (state.isPlaying) state.broadcastPause();
      },
      seekbackward: (details) => {
        const state = useGlobalStore.getState();
        seekTo(state.getCurrentTrackPosition() - (details.seekOffset ?? 15));
      },
      seekforward: (details) => {
        const state = useGlobalStore.getState();
        seekTo(state.getCurrentTrackPosition() + (details.seekOffset ?? 15));
      },
      seekto: (details) => {
        if (typeof details.seekTime === "number") seekTo(details.seekTime);
      },
      nexttrack: () => useGlobalStore.getState().skipToNextTrack(),
      previoustrack: () => useGlobalStore.getState().skipToPreviousTrack(),
    };

    for (const action of MEDIA_SESSION_ACTIONS) {
      try {
        navigator.mediaSession.setActionHandler(action, handlers[action] ?? null);
      } catch {
        // Safari versions expose mediaSession before supporting every action.
      }
    }

    return () => {
      for (const action of MEDIA_SESSION_ACTIONS) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {}
      }
    };
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";

    const updatePosition = () => {
      if (!Number.isFinite(duration) || duration <= 0) return;
      const position = Math.max(0, Math.min(useGlobalStore.getState().getCurrentTrackPosition(), duration));
      try {
        navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position });
      } catch {
        // Position state is best-effort on older iOS releases.
      }
    };

    updatePosition();
    if (!isPlaying) return;
    const interval = window.setInterval(updatePosition, 1_000);
    return () => window.clearInterval(interval);
  }, [duration, isPlaying, selectedAudioUrl]);

  return null;
};
