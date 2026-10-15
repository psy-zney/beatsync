"use client";

import { useRef, useState } from "react";
import { resolveSpotifyPlaylist, uploadAudioFile, type SpotifyResolveResponse } from "@/lib/api";
import { useCanMutate, useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum } from "@beatsync/shared";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckSquare, CloudUpload, FolderDown, ListMusic, Loader2, Plus, Square, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SavedPlaylistPicker } from "./SavedPlaylistPicker";
import { cn } from "@/lib/utils";

interface SpotifyImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SpotifyImportModal({ isOpen, onClose }: SpotifyImportModalProps) {
  const [tab, setTab] = useState<"upload" | "saved" | "spotify">("upload");
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [resolvedData, setResolvedData] = useState<SpotifyResolveResponse["data"] | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  // Upload tab states
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
    currentFileName?: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const socket = useGlobalStore((state) => state.socket);
  const canMutate = useCanMutate();
  const roomId = useRoomStore((state) => state.roomId);

  const handleFilesUpload = async (files: FileList | File[]) => {
    if (!canMutate) {
      toast.error("Only room admins can upload audio files.");
      return;
    }
    const audioFiles = Array.from(files).filter(
      (file) => file.type.startsWith("audio/") || file.name.match(/\.(mp3|wav|m4a|aac|ogg|webm|flac)$/i)
    );

    if (audioFiles.length === 0) {
      toast.error("Please select valid audio files (.mp3, .wav, .m4a, etc.)");
      return;
    }

    setIsUploading(true);
    let successCount = 0;
    try {
      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        setUploadProgress({ current: i + 1, total: audioFiles.length, currentFileName: file.name });
        await uploadAudioFile({ file, roomId });
        successCount++;
      }
      toast.success(
        audioFiles.length === 1
          ? `Uploaded ${audioFiles[0].name}`
          : `Successfully uploaded ${successCount} audio tracks`
      );
    } catch (err) {
      console.error("Upload error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to upload audio file");
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

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
              <FolderDown className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-white">Import music & playlists</DialogTitle>
              <DialogDescription className="mt-1 text-xs text-neutral-400">
                Upload audio files, reuse saved playlists, or import from Spotify
              </DialogDescription>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close import modal"
            className="text-neutral-400 hover:text-white p-1.5 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1 custom-scrollbar">
          <div className="grid grid-cols-3 gap-2" aria-label="Import source">
            <button
              type="button"
              aria-pressed={tab === "upload"}
              onClick={() => setTab("upload")}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                tab === "upload"
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : "bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800"
              }`}
            >
              Upload audio
            </button>
            <button
              type="button"
              aria-pressed={tab === "saved"}
              onClick={() => setTab("saved")}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                tab === "saved"
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : "bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800"
              }`}
            >
              Saved playlists
            </button>
            <button
              type="button"
              aria-pressed={tab === "spotify"}
              onClick={() => setTab("spotify")}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                tab === "spotify"
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : "bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800"
              }`}
            >
              Spotify
            </button>
          </div>

          {tab === "upload" && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => {
                  if (!canMutate || isUploading) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  if (!canMutate || isUploading) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragging(false);
                }}
                onDrop={(e) => {
                  if (!canMutate || isUploading) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragging(false);
                  if (e.dataTransfer?.files?.length) {
                    handleFilesUpload(e.dataTransfer.files);
                  }
                }}
                onClick={() => {
                  if (!canMutate || isUploading) return;
                  fileInputRef.current?.click();
                }}
                className={cn(
                  "relative flex flex-col items-center justify-center p-8 rounded-2xl border-2 border-dashed transition-all cursor-pointer text-center select-none",
                  isDragging
                    ? "border-emerald-500 bg-emerald-500/10 scale-[1.01]"
                    : "border-neutral-800 bg-neutral-900/40 hover:bg-neutral-900/80 hover:border-neutral-700",
                  (!canMutate || isUploading) && "cursor-not-allowed opacity-60"
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm,.flac"
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      handleFilesUpload(e.target.files);
                    }
                  }}
                  disabled={!canMutate || isUploading}
                  className="hidden"
                />

                <div className="size-14 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center mb-3 shadow-lg shadow-emerald-500/5">
                  {isUploading ? (
                    <Loader2 className="size-7 animate-spin text-emerald-400" />
                  ) : (
                    <CloudUpload className="size-7" />
                  )}
                </div>

                <div className="space-y-1 max-w-sm">
                  <h4 className="text-sm font-semibold text-white">
                    {isUploading
                      ? `Uploading (${uploadProgress?.current}/${uploadProgress?.total})...`
                      : "Choose audio files or drag & drop"}
                  </h4>
                  <p className="text-xs text-neutral-400">
                    {isUploading && uploadProgress?.currentFileName
                      ? uploadProgress.currentFileName
                      : "Supports MP3, WAV, M4A, AAC, OGG, FLAC, WEBM"}
                  </p>
                </div>

                {!isUploading && canMutate && (
                  <div className="mt-4 px-3.5 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-400 text-xs font-medium border border-emerald-500/30">
                    Browse local files
                  </div>
                )}

                {!canMutate && (
                  <p className="mt-3 text-xs text-amber-400/90 font-medium">
                    Only the room host or admin can upload audio files.
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-neutral-800/80 bg-neutral-900/30 p-3 text-xs text-neutral-400 space-y-1">
                <div className="font-medium text-neutral-300">💡 Tips</div>
                <ul className="list-disc list-inside space-y-0.5 text-neutral-400 text-[11px]">
                  <li>Files are uploaded directly to the room queue and synchronized with all listeners.</li>
                  <li>You can select or drop multiple audio tracks at once.</li>
                </ul>
              </div>
            </div>
          )}

          {tab === "saved" && <SavedPlaylistPicker onClose={onClose} />}

          {tab === "spotify" && (
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
