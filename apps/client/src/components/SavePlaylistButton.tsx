"use client";

import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { PERSISTENT_ROOM_ID } from "@/lib/browserLibrary";
import { useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";

interface SavePlaylistButtonProps {
  className?: string;
}

export const SavePlaylistButton = ({ className }: SavePlaylistButtonProps) => {
  const socket = useGlobalStore((s) => s.socket);
  const savePlaylist = useGlobalStore((s) => s.savePlaylist);
  const audioSourceCount = useGlobalStore((s) => s.audioSources.length);
  const roomId = useRoomStore((s) => s.roomId);
  const isPersistent = roomId === PERSISTENT_ROOM_ID;
  const [isSaving, setIsSaving] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = () => {
    if (isSaving) return;
    if (!isPersistent) {
      savePlaylist();
      return;
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    setIsSaving(true);

    // Call store method to trigger WS request
    savePlaylist();

    // Safety timeout in case WebSocket connection drops and no response is received
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsSaving(false);
    }, 4000);
  };

  useEffect(() => {
    if (!socket) return;
    const handleResponse = (event: MessageEvent<string>) => {
      try {
        const response = JSON.parse(event.data) as { type?: string };
        if (response.type === "SAVE_PLAYLIST_RESPONSE") {
          setIsSaving(false);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      } catch {
        // Other message handling belongs to WebSocketManager.
      }
    };
    socket.addEventListener("message", handleResponse);
    return () => socket.removeEventListener("message", handleResponse);
  }, [socket]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <button
      className={cn(
        "text-gray-400 hover:text-white transition-colors cursor-pointer hover:scale-105 duration-200 disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
      onClick={handleClick}
      disabled={isSaving || (isPersistent ? !socket : audioSourceCount === 0)}
      title={isPersistent ? "Save room 090624 playlist to R2" : "Save playlist in this browser"}
      aria-label={isPersistent ? "Save room 090624 playlist to R2" : "Save playlist in this browser"}
    >
      <Save className={cn("size-4", isSaving && "animate-bounce text-primary-400")} />
    </button>
  );
};

export default SavePlaylistButton;
