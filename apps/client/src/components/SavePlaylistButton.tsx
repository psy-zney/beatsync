"use client";

import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { motion } from "motion/react";
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
    <motion.button
      className={cn(
        "relative inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-neutral-800/80 hover:bg-neutral-700/95 text-neutral-200 rounded-full",
        "font-medium text-xs tracking-wide cursor-pointer border border-neutral-700/80 hover:border-neutral-600 transition-all duration-300",
        "shadow-md hover:shadow-zinc-900/50",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
      whileHover={{ scale: 1.02, translateY: -0.5 }}
      whileTap={{ scale: 0.98, translateY: 0 }}
      onClick={handleClick}
      disabled={isSaving || !socket}
    >
      <Save className={cn("size-3.5", isSaving && "animate-bounce text-primary-400")} />
      <span>{isSaving ? "Saving..." : "Save Playlist"}</span>
    </motion.button>
  );
};

export default SavePlaylistButton;
