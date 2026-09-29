"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { ListMusic, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  deleteBrowserPlaylist,
  LIBRARY_KEY,
  parseSavedPlaylists,
  readBrowserValue,
  subscribeLibrary,
} from "@/lib/browserLibrary";
import { useGlobalStore } from "@/store/global";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum, type AudioSourceType } from "@beatsync/shared";

export function SavedPlaylistPicker({ onClose }: { onClose: () => void }) {
  const raw = useSyncExternalStore(
    subscribeLibrary,
    () => readBrowserValue(LIBRARY_KEY),
    () => null
  );
  const playlists = useMemo(() => parseSavedPlaylists(raw), [raw]);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const playlist = playlists.find((item) => item.roomId === selectedRoom) ?? playlists[0];
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const socket = useGlobalStore((state) => state.socket);
  const selected = playlist?.tracks.filter((track) => !excluded.has(track.url)) ?? [];

  const importSelected = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return toast.error("Not connected to the server.");
    if (!selected.length) return;
    // Keep each message below the backend's 64 KiB limit, including long titles.
    const batches: AudioSourceType[][] = [[]];
    for (const track of selected) {
      let batch = batches[batches.length - 1];
      if (new TextEncoder().encode(JSON.stringify([...batch, track])).byteLength > 48_000) {
        batch = [];
        batches.push(batch);
      }
      batch.push(track);
    }
    for (const sources of batches) {
      if (!sendWSRequest({ ws: socket, request: { type: ClientActionEnum.enum.IMPORT_PLAYLIST, sources } })) {
        return toast.error("Connection lost. Try importing again once the connection is restored.");
      }
    }
    toast.success(`Requested ${selected.length} tracks for this room.`);
    onClose();
  };

  if (!playlists.length)
    return (
      <div className="py-10 text-center">
        <ListMusic className="mx-auto mb-3 size-8 text-neutral-500" />
        <p className="text-sm text-neutral-300">No saved playlists yet</p>
        <p className="mt-2 text-xs text-neutral-500">Use Save in the player to keep your playlist.</p>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex max-h-40 flex-col gap-2 overflow-y-auto">
        {playlists.map((item) => (
          <div
            key={item.roomId}
            className={`flex items-center gap-2 rounded-xl border ${playlist?.roomId === item.roomId ? "border-emerald-500/40 bg-emerald-500/10" : "border-neutral-800 bg-neutral-900"}`}
          >
            <button
              type="button"
              onClick={() => {
                setSelectedRoom(item.roomId);
                setExcluded(new Set());
              }}
              aria-pressed={playlist?.roomId === item.roomId}
              className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
            >
              <ListMusic className="size-5 shrink-0 text-emerald-400" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">Room playlist {item.roomId}</p>
                <p className="mt-1 text-[11px] text-neutral-400">
                  {item.tracks.length} tracks · {new Date(item.savedAt).toLocaleDateString("en-US")}
                </p>
              </div>
            </button>
            <button
              type="button"
              aria-label={`Delete room playlist ${item.roomId}`}
              onClick={() => {
                try {
                  deleteBrowserPlaylist(item.roomId);
                  setExcluded(new Set());
                } catch {
                  toast.error("Could not delete this playlist from your browser.");
                }
              }}
              className="mr-2 rounded-lg p-2 text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-neutral-400">
        <span>
          {selected.length} / {playlist?.tracks.length ?? 0} tracks selected
        </span>
        <button
          type="button"
          onClick={() => setExcluded(selected.length ? new Set(playlist?.tracks.map((track) => track.url)) : new Set())}
          className="rounded-lg px-2 py-1 text-emerald-400 hover:bg-neutral-800"
        >
          {selected.length ? "Deselect all" : "Select all"}
        </button>
      </div>
      <div className="max-h-52 space-y-1 overflow-y-auto">
        {playlist?.tracks.map((track) => (
          <label
            key={track.url}
            className="flex cursor-pointer items-center gap-3 rounded-lg p-2.5 hover:bg-neutral-800/70"
          >
            <input
              type="checkbox"
              checked={!excluded.has(track.url)}
              onChange={() =>
                setExcluded((previous) => {
                  const next = new Set(previous);
                  if (next.has(track.url)) next.delete(track.url);
                  else next.add(track.url);
                  return next;
                })
              }
              className="size-4 shrink-0 accent-emerald-500"
            />
            <span className="truncate text-xs text-neutral-200">{track.title || "Saved track"}</span>
          </label>
        ))}
      </div>
      <Button
        onClick={importSelected}
        disabled={!selected.length || !socket}
        className="w-full rounded-xl bg-emerald-600 text-white hover:bg-emerald-500"
      >
        Add {selected.length} tracks to room
      </Button>
    </div>
  );
}
