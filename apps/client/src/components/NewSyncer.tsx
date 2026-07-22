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

// Main component has been refactored into smaller components
export const NewSyncer = ({ roomId }: NewSyncerProps) => {
  const setUsername = useRoomStore((state) => state.setUsername);
  const setAvatar = useRoomStore((state) => state.setAvatar);
  const setRoomId = useRoomStore((state) => state.setRoomId);
  const username = useRoomStore((state) => state.username);
  const [isProfileReady, setIsProfileReady] = useState(false);

  // Update document title based on playback state
  useDocumentTitle();

  useEffect(() => {
    setRoomId(roomId);
    const profile = readLocalProfile();
    if (profile) {
      setUsername(profile.name);
      setAvatar(profile.avatar);
    }
    queueMicrotask(() => setIsProfileReady(true));
  }, [setUsername, setAvatar, roomId, setRoomId]);

  if (!isProfileReady) return null;
  if (!username) {
    return (
      <ProfileSetup
        onSave={(profile) => {
          saveLocalProfile(profile);
          setUsername(profile.name);
          setAvatar(profile.avatar);
        }}
      />
    );
  }

  return (
    <VoiceChatProvider>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
        {/* WebSocket connection manager (non-visual component) */}
        <WebSocketManager roomId={roomId} username={username} />

        {/* Spatial audio background effects */}
        {/* <SpatialAudioBackground /> */}

        {IS_DEMO_MODE ? <DemoDashboard roomId={roomId} /> : <Dashboard roomId={roomId} />}
      </motion.div>
    </VoiceChatProvider>
  );
};
