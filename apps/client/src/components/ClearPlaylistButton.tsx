"use client";

import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { motion } from "motion/react";
import { Trash2 } from "lucide-react";

interface ClearPlaylistButtonProps {
  className?: string;
}

export const ClearPlaylistButton = ({ className }: ClearPlaylistButtonProps) => {
  const socket = useGlobalStore((s) => s.socket);
  const clearPlaylist = useGlobalStore((s) => s.clearPlaylist);
  const audioSourcesCount = useGlobalStore((s) => s.audioSources.length);

  const handleClick = () => {
    if (!socket || audioSourcesCount === 0) return;
    clearPlaylist();
  };

  return (
    <motion.button
      className={cn(
        "relative inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-red-900/40 hover:bg-red-800/60 text-red-200 rounded-full",
        "font-medium text-xs tracking-wide cursor-pointer border border-red-900/50 hover:border-red-700/80 transition-all duration-300",
        "shadow-md hover:shadow-red-900/20",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
      whileHover={{ scale: 1.02, translateY: -0.5 }}
      whileTap={{ scale: 0.98, translateY: 0 }}
      onClick={handleClick}
      disabled={!socket || audioSourcesCount === 0}
      title="Clear Playlist"
    >
      <Trash2 className="size-3.5" />
      <span>Clear</span>
    </motion.button>
  );
};

export default ClearPlaylistButton;
