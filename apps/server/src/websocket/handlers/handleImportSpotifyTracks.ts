import { globalManager } from "@/managers";
import { MUSIC_PROVIDER_MANAGER } from "@/managers/MusicProviderManager";
import type { ImportSpotifyTracksType, StreamMusicType } from "@beatsync/shared";
import type { HandlerFunction } from "@/websocket/types";
import { sleep } from "bun";
import { handleStreamMusic } from "./handleStreamMusic";

export const handleImportSpotifyTracks: HandlerFunction<ImportSpotifyTracksType> = async ({
  ws,
  message,
  server,
}) => {
  const room = globalManager.getRoom(ws.data.roomId);
  if (!room) return;

  const tracks = message.tracks;
  console.log(`[Room: ${ws.data.roomId}] Queueing ${tracks.length} Spotify tracks for background import`);

  // Start background loop
  // We do not await this, it runs in the background.
  void (async () => {
    let addedCount = 0;

    for (const track of tracks) {
      // Check if room is still active
      if (!globalManager.getRoom(ws.data.roomId)) break;

      try {
        const query = `${track.title} ${track.artist}`;
        const searchResult = await MUSIC_PROVIDER_MANAGER.search(query, 0);
        const firstItem = searchResult.data.tracks.items[0] ?? null;

        if (firstItem) {
          const trackId = firstItem.id;
          const artistName = String((firstItem.performer as { name?: string })?.name || track.artist || "Spotify");
          const title = String(firstItem.title || track.title);
          const formattedTrackName = `${artistName} - ${title}`;

          // Reuse the stream music handler for each found track
          const streamMessage: StreamMusicType = {
            type: "STREAM_MUSIC",
            trackId,
            trackName: formattedTrackName,
          };

          await handleStreamMusic({ ws, message: streamMessage, server });
          addedCount++;
        }
      } catch (err) {
        console.warn(`Failed to resolve YouTube track for "${track.title} ${track.artist}":`, err);
      }

      // Pause for 1 second between processing tracks to avoid YouTube rate limits & OOM
      await sleep(1000);
    }

    console.log(`[Room: ${ws.data.roomId}] Completed background Spotify import, added ${addedCount} tracks.`);
  })();
}
