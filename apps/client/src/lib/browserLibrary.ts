import { TrackLyricsSchema, type AudioSourceType } from "@beatsync/shared";
import { validateFullRoomId } from "./room";

export const PERSISTENT_ROOM_ID = "090624";
export const LIBRARY_KEY = "beatsync-playlists-v1";
export const RECENT_ROOMS_KEY = "beatsync-recent-rooms-v1";
export const LIBRARY_EVENT = "beatsync-library-change";
const MAX_PLAYLISTS = 20;
const MAX_TRACKS = 500;
const MAX_LIBRARY_BYTES = 1_000_000;

export interface SavedPlaylist {
  roomId: string;
  savedAt: number;
  tracks: AudioSourceType[];
}

// Store stable references, titles and optional lyrics, never audio buffers.
export function compactTrackUrl(url: string): string {
  const cached = url.match(/\/youtube-cache\/([A-Za-z0-9_-]{11})\.[a-z0-9]+(?:\?.*)?$/);
  if (cached) return cached[1];
  const proxy = url.match(/^\/youtube\/proxy\?videoId=([A-Za-z0-9_-]{11})$/);
  return proxy?.[1] ?? url;
}

export function expandTrackUrl(url: string): string {
  return /^[A-Za-z0-9_-]{11}$/.test(url) ? `/youtube/proxy?videoId=${url}` : url;
}

export function readBrowserValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function parseSavedPlaylists(raw: string | null): SavedPlaylist[] {
  try {
    const data: unknown = JSON.parse(raw ?? "null");
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    return data
      .flatMap((entry: unknown) => {
        if (!Array.isArray(entry) || entry.length !== 3) return [];
        const [roomId, savedAt, tuples] = entry;
        if (
          typeof roomId !== "string" ||
          !validateFullRoomId(roomId) ||
          seen.has(roomId) ||
          typeof savedAt !== "number" ||
          !Number.isFinite(savedAt) ||
          !Array.isArray(tuples)
        )
          return [];
        const urls = new Set<string>();
        const tracks = tuples.slice(0, MAX_TRACKS).flatMap((tuple: unknown) => {
          if (!Array.isArray(tuple) || typeof tuple[0] !== "string" || !tuple[0] || tuple[0].length > 2048) return [];
          const url = expandTrackUrl(tuple[0]);
          if (urls.has(url)) return [];
          urls.add(url);
          const lyrics = TrackLyricsSchema.safeParse(tuple[2]);
          return [
            {
              url,
              title: typeof tuple[1] === "string" ? tuple[1].slice(0, 300) : undefined,
              ...(lyrics.success ? { lyrics: lyrics.data } : {}),
            },
          ];
        });
        if (!tracks.length) return [];
        seen.add(roomId);
        return [{ roomId, savedAt, tracks }];
      })
      .slice(0, MAX_PLAYLISTS);
  } catch {
    return [];
  }
}

export const readSavedPlaylists = () => parseSavedPlaylists(readBrowserValue(LIBRARY_KEY));

function writePlaylists(playlists: SavedPlaylist[]): void {
  const value = JSON.stringify(
    playlists.map(({ roomId, savedAt, tracks }) => [
      roomId,
      savedAt,
      tracks.map(({ url, title, lyrics }) =>
        lyrics ? [compactTrackUrl(url), title ?? "", lyrics] : [compactTrackUrl(url), title ?? ""]
      ),
    ])
  );
  if (new TextEncoder().encode(value).byteLength > MAX_LIBRARY_BYTES) {
    throw new Error("Your library is full. Delete an old playlist and try again.");
  }
  window.localStorage.setItem(LIBRARY_KEY, value);
  window.dispatchEvent(new Event(LIBRARY_EVENT));
}

export function saveBrowserPlaylist(roomId: string, tracks: AudioSourceType[]): void {
  if (!validateFullRoomId(roomId) || !tracks.length) throw new Error("There are no tracks to save.");
  if (tracks.length > MAX_TRACKS) throw new Error(`Each saved playlist can contain up to ${MAX_TRACKS} tracks.`);
  const previous = readSavedPlaylists().filter((playlist) => playlist.roomId !== roomId);
  if (previous.length >= MAX_PLAYLISTS)
    throw new Error(`Your library can hold up to ${MAX_PLAYLISTS} playlists. Delete an old playlist and try again.`);
  writePlaylists([{ roomId, savedAt: Date.now(), tracks }, ...previous]);
}

export function deleteBrowserPlaylist(roomId: string): void {
  writePlaylists(readSavedPlaylists().filter((playlist) => playlist.roomId !== roomId));
}

export function readRecentRooms(): string[] {
  try {
    const data: unknown = JSON.parse(readBrowserValue(RECENT_ROOMS_KEY) ?? "null");
    return Array.isArray(data)
      ? [...new Set(data.filter((id): id is string => typeof id === "string" && validateFullRoomId(id)))].slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

export function rememberRecentRoom(roomId: string): void {
  if (!validateFullRoomId(roomId)) return;
  try {
    window.localStorage.setItem(
      RECENT_ROOMS_KEY,
      JSON.stringify([roomId, ...readRecentRooms().filter((id) => id !== roomId)].slice(0, 6))
    );
  } catch {
    // Joining a room still works when browser storage is unavailable.
  }
}

export function subscribeLibrary(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(LIBRARY_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(LIBRARY_EVENT, callback);
  };
}
