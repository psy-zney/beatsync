"use client";

import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";

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
    <button
      className={cn(
        "text-gray-400 hover:text-white transition-colors cursor-pointer hover:scale-105 duration-200 disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
      onClick={handleClick}
      disabled={!socket || audioSourcesCount === 0}
      title="Clear Playlist"
    >
      <Trash2 className="size-4" />
    </button>
  );
};

export default ClearPlaylistButton;
