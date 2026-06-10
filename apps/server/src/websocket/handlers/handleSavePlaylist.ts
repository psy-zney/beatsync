import { IS_DEMO_MODE } from "@/demo";
import { sendUnicast } from "@/utils/responses";
import { requireCanMutate } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";
import type { ExtractWSRequestFrom } from "@beatsync/shared";

export const handleSavePlaylist: HandlerFunction<ExtractWSRequestFrom["SAVE_PLAYLIST"]> = async ({ ws }) => {
  if (IS_DEMO_MODE) {
    sendUnicast({
      ws,
      message: {
        type: "SAVE_PLAYLIST_RESPONSE",
        success: false,
        message: "Saving playlists is disabled in demo mode.",
        deletedCount: 0,
      },
    });
    return;
  }

  const { room } = requireCanMutate(ws);

  try {
    // Save the playlist to R2
    await room.savePlaylist();

    // Clean up unused room-specific files in R2
    const { deletedCount } = await room.cleanupUnusedFiles();

    let message = "Playlist saved successfully!";
    if (deletedCount > 0) {
      message += ` Cleaned up ${deletedCount} unused file(s) from the bucket.`;
    }

    sendUnicast({
      ws,
      message: {
        type: "SAVE_PLAYLIST_RESPONSE",
        success: true,
        message,
        deletedCount,
      },
    });
  } catch (error) {
    console.error(`[SavePlaylist] Failed to save playlist in room ${ws.data.roomId}:`, error);
    sendUnicast({
      ws,
      message: {
        type: "SAVE_PLAYLIST_RESPONSE",
        success: false,
        message: `Failed to save playlist: ${error instanceof Error ? error.message : String(error)}`,
        deletedCount: 0,
      },
    });
  }
};
