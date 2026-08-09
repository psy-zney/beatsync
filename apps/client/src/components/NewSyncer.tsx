"use client";
import { readLocalProfile, saveLocalProfile } from "@/lib/profile";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useRoomStore } from "@/store/room";
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
import type { LocalProfile } from "@/lib/profile";

// Main component has been refactored into smaller components
export const NewSyncer = ({ roomId }: NewSyncerProps) => {
  const setUsername = useRoomStore((state) => state.setUsername);
  const setAvatar = useRoomStore((state) => state.setAvatar);
  const setRoomId = useRoomStore((state) => state.setRoomId);
  const username = useRoomStore((state) => state.username);

  const [isConfirmedProfile, setIsConfirmedProfile] = useState(false);
  const [localProfile] = useState<LocalProfile | null>(() => {
    if (typeof window !== "undefined") {
      return readLocalProfile();
    }
    return null;
  });
  const [isLoaded, setIsLoaded] = useState(false);

  // Update document title based on playback state
  useDocumentTitle();

  useEffect(() => {
    setRoomId(roomId);
    queueMicrotask(() => setIsLoaded(true));
  }, [roomId, setRoomId]);

  if (!isLoaded) return null;

  if (!isConfirmedProfile) {
    return (
      <ProfileSetup
        initialProfile={localProfile}
        onSave={(profile) => {
          saveLocalProfile(profile);
          setUsername(profile.name);
          setAvatar(profile.avatar);
          setIsConfirmedProfile(true);
        }}
      />
    );
  }

  return (
    <VoiceChatProvider>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
        {/* WebSocket connection manager (non-visual component) */}
        <WebSocketManager roomId={roomId} username={username} />
        <FlyAudioController />

        {/* Spatial audio background effects */}
        {/* <SpatialAudioBackground /> */}

        {IS_DEMO_MODE ? <DemoDashboard roomId={roomId} /> : <Dashboard roomId={roomId} />}
      </motion.div>
    </VoiceChatProvider>
  );
};
