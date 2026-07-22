"use client";

import { uploadYoutubeLink } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCanMutate } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { Loader2, Youtube } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SpotifyImportModal } from "./SpotifyImportModal";

const SpotifyLogo = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm5.521 17.341c-.217.357-.68.473-1.037.256-2.856-1.745-6.452-2.14-10.686-1.171-.406.092-.811-.161-.904-.567-.092-.406.161-.811.567-.904 4.636-1.06 8.599-.607 11.804 1.353.357.217.473.68.256 1.037zm1.472-3.275c-.273.443-.852.584-1.295.312-3.268-2.008-8.25-2.59-12.115-1.417-.497.151-1.026-.134-1.177-.631-.151-.497.134-1.026.631-1.177 4.417-1.341 9.9-0.7 13.644 1.6 1.6 1.6.443.273.584.852.312 1.295zm.143-3.411c-3.921-2.328-10.39-2.544-14.154-1.399-.608.185-1.249-.166-1.434-.774-.185-.608.166-1.249.774-1.434 4.319-1.311 11.458-1.052 15.965 1.624.547.324.726 1.034.402 1.581-.324.547-1.034.726-1.581.402z" />
  </svg>
);

export const YoutubeInput = () => {
  const [url, setUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isSpotifyOpen, setIsSpotifyOpen] = useState(false);
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
    <>
      <div
        className={cn(
          "border border-neutral-700/50 rounded-md mx-2 mt-2 transition-all overflow-hidden p-2.5",
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
            placeholder={isDisabled ? "Admin only" : "Paste YouTube URL..."}
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-neutral-500 outline-none focus:ring-0 border-none px-1"
            required
          />

          {!isDisabled && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="submit"
                disabled={isUploading || !url.trim()}
                className="text-xs font-medium bg-neutral-700 hover:bg-neutral-600 text-white px-2 py-1 rounded disabled:opacity-50 transition-colors"
              >
                Add
              </button>

              <button
                type="button"
                onClick={() => setIsSpotifyOpen(true)}
                title="Nhập Playlist từ Spotify"
                className="flex items-center gap-1 text-xs font-medium bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded transition-colors cursor-pointer"
              >
                <SpotifyLogo className="h-3.5 w-3.5" />
                Spotify
              </button>
            </div>
          )}
        </form>
      </div>

      <SpotifyImportModal isOpen={isSpotifyOpen} onClose={() => setIsSpotifyOpen(false)} />
    </>
  );
};
