"use client";
import { readLocalProfile, saveLocalProfile } from "@/lib/profile";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useRoomStore } from "@/store/room";
import { useGlobalStore } from "@/store/global";
import { useChatStore } from "@/store/chat";
import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { IS_DEMO_MODE } from "@/lib/demo";
import { Dashboard } from "./dashboard/Dashboard";
import { DemoDashboard } from "./dashboard/DemoDashboard";
import { WebSocketManager } from "./room/WebSocketManager";

interface NewSyncerProps {
  roomId: string;
}

import { VoiceChatProvider } from "./room/VoiceChatProvider";
import { ProfileSetup } from "./ProfileSetup";
import { FlyAudioController } from "./room/FlyAudioController";
import { MediaSessionController } from "./room/MediaSessionController";
import type { LocalProfile } from "@/lib/profile";

// Main component has been refactored into smaller components
export const NewSyncer = ({ roomId }: NewSyncerProps) => {
  const setUsername = useRoomStore((state) => state.setUsername);
  const setAvatar = useRoomStore((state) => state.setAvatar);
  const setRoomId = useRoomStore((state) => state.setRoomId);
  const username = useRoomStore((state) => state.username);

  const [isConfirmedProfile, setIsConfirmedProfile] = useState(false);
  const [localProfile, setLocalProfile] = useState<LocalProfile | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Update document title based on playback state
  useDocumentTitle();

  useEffect(() => {
    if (useRoomStore.getState().roomId !== roomId) {
      useGlobalStore.getState().resetStore();
      useChatStore.getState().reset();
      useRoomStore.getState().reset();
    }
    setRoomId(roomId);
    const saved = readLocalProfile();
    const current = useRoomStore.getState();
    const profile = saved ?? (current.username ? { name: current.username, avatar: current.avatar } : null);
    if (profile) {
      setUsername(profile.name);
      setAvatar(profile.avatar);
    }
    queueMicrotask(() => {
      setLocalProfile(profile);
      setIsConfirmedProfile(!!profile);
      setIsLoaded(true);
    });
  }, [roomId, setRoomId, setUsername, setAvatar]);

  if (!isLoaded) return null;

  if (!isConfirmedProfile) {
    return (
      <ProfileSetup
        initialProfile={localProfile}
        onSave={(profile) => {
          try {
            saveLocalProfile(profile);
          } catch {
            /* Profile still works for this session. */
          }
          setUsername(profile.name);
          setAvatar(profile.avatar);
          setIsConfirmedProfile(true);
        }}
      >
        <div className="my-6 text-center">
          <p className="text-sm text-neutral-400">You are joining room</p>
          <p className="mt-2 font-mono text-3xl tracking-[0.2em]">{roomId}</p>
          {!IS_DEMO_MODE && (
            <Link href="/" className="mt-3 inline-block text-xs text-neutral-400 hover:text-white">
              Choose another room
            </Link>
          )}
        </div>
      </ProfileSetup>
    );
  }

  return (
    <VoiceChatProvider>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
        {/* WebSocket connection manager (non-visual component) */}
        <WebSocketManager roomId={roomId} username={username} />
        <FlyAudioController />
        <MediaSessionController />

        {/* Spatial audio background effects */}
        {/* <SpatialAudioBackground /> */}

        {IS_DEMO_MODE ? <DemoDashboard roomId={roomId} /> : <Dashboard roomId={roomId} />}
      </motion.div>
    </VoiceChatProvider>
  );
};
