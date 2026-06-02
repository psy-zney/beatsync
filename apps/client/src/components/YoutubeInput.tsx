"use client";

import { uploadYoutubeLink } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCanMutate } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { Loader2, Youtube } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const YoutubeInput = () => {
  const [url, setUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const canMutate = useCanMutate();
  const roomId = useRoomStore((state) => state.roomId);

  const isDisabled = !canMutate;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDisabled || !url.trim() || isUploading) return;

    try {
      setIsUploading(true);
      await uploadYoutubeLink({
        url: url.trim(),
        roomId,
      });
      setUrl("");
      toast.success("Added YouTube audio to queue");
    } catch (err) {
      console.error("Error adding YouTube audio:", err);
      toast.error(err instanceof Error ? err.message : "Failed to add YouTube audio");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      className={cn(
        "border border-neutral-700/50 rounded-md mx-2 mt-2 transition-all overflow-hidden p-3",
        isDisabled ? "bg-neutral-800/20 opacity-50" : "bg-neutral-800/30"
      )}
    >
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div
          className={cn(
            "p-1.5 rounded-md flex-shrink-0",
            isDisabled ? "bg-neutral-600 text-neutral-400" : "bg-[#FF0000] text-white"
          )}
        >
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Youtube className="h-4 w-4" />}
        </div>

        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isDisabled || isUploading}
          placeholder={isDisabled ? "Admin only" : "Paste YouTube URL here..."}
          className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-neutral-500 outline-none focus:ring-0 border-none px-1"
          required
        />

        {!isDisabled && (
          <button
            type="submit"
            disabled={isUploading || !url.trim()}
            className="text-xs font-medium bg-neutral-700 hover:bg-neutral-600 text-white px-2 py-1 rounded disabled:opacity-50 transition-colors"
          >
            Add
          </button>
        )}
      </form>
    </div>
  );
};
