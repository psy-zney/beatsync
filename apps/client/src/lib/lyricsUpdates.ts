import type { AudioSourceType, TrackLyricsUpdateType } from "@beatsync/shared";

export function mergeLyricsUpdate(source: AudioSourceType, update: TrackLyricsUpdateType): AudioSourceType {
  if (source.url !== update.audioSource || (source.lyricsVersion ?? 0) > update.lyricsVersion) return source;
  return {
    ...source,
    lyrics: update.lyrics ?? undefined,
    lyricsState: update.lyricsState || undefined,
    lyricsVersion: update.lyricsVersion,
  };
}
