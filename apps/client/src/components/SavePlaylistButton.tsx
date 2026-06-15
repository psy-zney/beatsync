"use client";

import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";

interface SavePlaylistButtonProps {
  className?: string;
}

export const SavePlaylistButton = ({ className }: SavePlaylistButtonProps) => {
  const socket = useGlobalStore((s) => s.socket);
  const savePlaylist = useGlobalStore((s) => s.savePlaylist);
  const [isSaving, setIsSaving] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = () => {
    if (!socket || isSaving) return;
    setIsSaving(true);

    // Call store method to trigger WS request
    savePlaylist();

    // Safety timeout in case WebSocket connection drops and no response is received
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsSaving(false);
    }, 4000);
  };

  // Listen to incoming messages or reset state
  // We can also reset isSaving whenever the global message timestamp updates
  const lastMessageReceivedTime = useGlobalStore((s) => s.lastMessageReceivedTime);
  useEffect(() => {
    if (isSaving) {
      setIsSaving(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessageReceivedTime]);

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
      disabled={isSaving || !socket}
      title="Save Playlist"
    >
      <Save className={cn("size-4", isSaving && "animate-bounce text-primary-400")} />
    </button>
  );
};

export default SavePlaylistButton;
