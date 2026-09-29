"use client";

import { useState } from "react";
import { resolveSpotifyPlaylist, type SpotifyResolveResponse } from "@/lib/api";
import { useGlobalStore } from "@/store/global";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum } from "@beatsync/shared";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckSquare, ListMusic, Loader2, Plus, Square, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SavedPlaylistPicker } from "./SavedPlaylistPicker";
import { readSavedPlaylists } from "@/lib/browserLibrary";

// Spotify Green Brand Color SVG Icon
const SpotifyLogo = ({ className = "size-4" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm5.521 17.341c-.217.357-.68.473-1.037.256-2.856-1.745-6.452-2.14-10.686-1.171-.406.092-.811-.161-.904-.567-.092-.406.161-.811.567-.904 4.636-1.06 8.599-.607 11.804 1.353.357.217.473.68.256 1.037zm1.472-3.275c-.273.443-.852.584-1.295.312-3.268-2.008-8.25-2.59-12.115-1.417-.497.151-1.026-.134-1.177-.631-.151-.497.134-1.026.631-1.177 4.417-1.341 9.9-0.7 13.644 1.6 1.6 1.6.443.273.584.852.312 1.295zm.143-3.411c-3.921-2.328-10.39-2.544-14.154-1.399-.608.185-1.249-.166-1.434-.774-.185-.608.166-1.249.774-1.434 4.319-1.311 11.458-1.052 15.965 1.624.547.324.726 1.034.402 1.581-.324.547-1.034.726-1.581.402z" />
  </svg>
);

interface SpotifyImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SpotifyImportModal({ isOpen, onClose }: SpotifyImportModalProps) {
  const [tab, setTab] = useState<"saved" | "spotify">(() => (readSavedPlaylists().length ? "saved" : "spotify"));
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [resolvedData, setResolvedData] = useState<SpotifyResolveResponse["data"] | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  const socket = useGlobalStore((state) => state.socket);

  const handleAnalyze = async () => {
    const cleanUrl = spotifyUrl.trim();
    if (!cleanUrl) return toast.error("Please enter a Spotify playlist, album, or track link.");

    setIsLoading(true);
    setResolvedData(null);
    setSelectedIndices(new Set());

    try {
      // Fast resolve: returns only Spotify metadata, no YouTube searches!
      const res = await resolveSpotifyPlaylist(cleanUrl, 500);

      if (res.success && res.data) {
        setResolvedData(res.data);
        // Select all tracks by default
        const allIndices = new Set<number>();
        res.data.tracks.forEach((_, index) => allIndices.add(index));
        setSelectedIndices(allIndices);
        toast.success(`Found ${res.data.tracks.length} tracks in ${res.data.title}`);
      } else {
        toast.error("Could not resolve this Spotify playlist.");
      }
    } catch (err) {
      console.error("Spotify resolve error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to load Spotify details.");
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle single selection
  const toggleTrack = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // Toggle select all
  const toggleSelectAll = () => {
    if (!resolvedData) return;
    if (selectedIndices.size === resolvedData.tracks.length) {
      setSelectedIndices(new Set());
    } else {
      const allIndices = new Set(resolvedData.tracks.map((_, i) => i));
      setSelectedIndices(allIndices);
    }
  };

  // Add selected tracks to room playlist
  const handleAddSelectedToRoom = async () => {
    if (!socket) return toast.error("Not connected to the server.");
    if (!resolvedData || selectedIndices.size === 0) return toast.error("No tracks selected.");

    setIsAdding(true);

    try {
      const itemsToAdd = Array.from(selectedIndices)
        .map((idx) => resolvedData.tracks[idx])
        .filter(Boolean);

      // Send the batch of tracks to the server to be processed in the background queue
      sendWSRequest({
        ws: socket,
        request: {
          type: ClientActionEnum.enum.IMPORT_SPOTIFY_TRACKS,
          tracks: itemsToAdd.map((track) => ({
            title: track.title,
            artist: track.artist,
            coverUrl: track.coverUrl,
          })),
        },
      });

      toast.success(`Adding ${itemsToAdd.length} tracks to the queue...`);
      onClose();
      // Reset modal state
      setResolvedData(null);
      setSpotifyUrl("");
    } catch (err) {
      console.error("Error sending Spotify tracks to queue:", err);
      toast.error("Failed to add tracks to this room.");
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-xl rounded-2xl bg-neutral-950 border-emerald-900/40 p-0 gap-0 shadow-2xl overflow-hidden flex flex-col max-h-[85dvh]"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-900/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <SpotifyLogo className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-white">Import playlist</DialogTitle>
              <DialogDescription className="mt-1 text-xs text-neutral-400">
                Reuse a saved playlist or import from Spotify
              </DialogDescription>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close playlist import"
            className="text-neutral-400 hover:text-white p-1.5 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1 custom-scrollbar">
          <div className="grid grid-cols-2 gap-2" aria-label="Playlist source">
            <button
              type="button"
              aria-pressed={tab === "saved"}
              onClick={() => setTab("saved")}
              className={`rounded-lg px-3 py-2 text-xs font-medium ${tab === "saved" ? "bg-emerald-500/15 text-emerald-400" : "bg-neutral-900 text-neutral-400"}`}
            >
              Saved playlists
            </button>
            <button
              type="button"
              aria-pressed={tab === "spotify"}
              onClick={() => setTab("spotify")}
              className={`rounded-lg px-3 py-2 text-xs font-medium ${tab === "spotify" ? "bg-emerald-500/15 text-emerald-400" : "bg-neutral-900 text-neutral-400"}`}
            >
              Spotify
            </button>
          </div>
          {tab === "saved" ? (
            <SavedPlaylistPicker onClose={onClose} />
          ) : (
            <>
              {/* Input Section */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="url"
                    value={spotifyUrl}
                    onChange={(e) => setSpotifyUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !isLoading && handleAnalyze()}
                    placeholder="https://open.spotify.com/playlist/..."
                    className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder:text-neutral-500 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                  />
                </div>
                <Button
                  onClick={handleAnalyze}
                  disabled={isLoading || !spotifyUrl.trim()}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs sm:text-sm px-4 shrink-0 shadow-lg shadow-emerald-600/20"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="size-4 animate-spin mr-1.5" />
                      Loading...
                    </>
                  ) : (
                    "Find tracks"
                  )}
                </Button>
              </div>

              {/* Resolved Tracks Preview Section */}
              {resolvedData && (
                <div className="space-y-3 pt-2">
                  {/* Playlist info bar */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-neutral-900 border border-neutral-800">
                    <div className="flex items-center gap-3 min-w-0">
                      {resolvedData.coverUrl ? (
                        <img
                          src={resolvedData.coverUrl}
                          alt={resolvedData.title}
                          className="size-10 rounded-lg object-cover shadow-sm shrink-0"
                        />
                      ) : (
                        <div className="size-10 rounded-lg bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-400 shrink-0">
                          <ListMusic className="size-5" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-white truncate">{resolvedData.title}</h3>
                        <p className="text-[11px] text-neutral-400">
                          {resolvedData.tracks.length} tracks • {selectedIndices.size} selected
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={toggleSelectAll}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-300 border border-neutral-700/60 transition-colors shrink-0"
                    >
                      {selectedIndices.size === resolvedData.tracks.length ? (
                        <>
                          <CheckSquare className="size-3.5 text-emerald-400" /> Deselect all
                        </>
                      ) : (
                        <>
                          <Square className="size-3.5 text-neutral-400" /> Select all
                        </>
                      )}
                    </button>
                  </div>

                  {/* Tracks List */}
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {resolvedData.tracks.map(
                      (
                        item: { title?: string; artist?: string; spotify?: { title: string; artist: string } },
                        idx: number
                      ) => {
                        const isSelected = selectedIndices.has(idx);
                        // In the new flow, we don't have youtubeTrack yet.
                        // Fallback for old cached data just in case
                        const title = item.title || item.spotify?.title;
                        const artist = item.artist || item.spotify?.artist;

                        return (
                          <div
                            key={idx}
                            onClick={() => toggleTrack(idx)}
                            className={`flex items-center gap-3 p-2.5 rounded-xl border text-xs transition-all cursor-pointer ${
                              isSelected
                                ? "border-emerald-500/40 bg-emerald-500/10 text-white"
                                : "border-neutral-800 bg-neutral-900/60 hover:bg-neutral-800/80 text-neutral-300"
                            }`}
                          >
                            <div className="shrink-0 text-emerald-400">
                              {isSelected ? (
                                <CheckSquare className="size-4" />
                              ) : (
                                <Square className="size-4 text-neutral-600" />
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-white truncate">{title}</div>
                              <div className="text-[11px] text-neutral-400 truncate">{artist}</div>
                            </div>
                          </div>
                        );
                      }
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        {tab === "spotify" && resolvedData && (
          <div className="p-4 border-t border-neutral-800 bg-neutral-900/50 flex items-center justify-between gap-3">
            <span className="text-xs text-neutral-400">
              {selectedIndices.size} / {resolvedData.tracks.length} tracks ready
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={onClose}
                className="border-neutral-700 text-neutral-300 hover:bg-neutral-800 text-xs"
              >
                Close
              </Button>
              <Button
                onClick={handleAddSelectedToRoom}
                disabled={isAdding || selectedIndices.size === 0}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-4 shadow-lg shadow-emerald-600/20"
              >
                {isAdding ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin mr-1.5" /> Adding...
                  </>
                ) : (
                  <>
                    <Plus className="size-3.5 mr-1" /> Add to queue
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
