import type { ServerWebSocket } from "bun";
import type { RoomManager } from "@/managers";
import { globalManager } from "@/managers";
import type { WSData } from "@/utils/websocket";

export const requireRoom = (ws: ServerWebSocket<WSData>): { room: RoomManager } => {
  if (!ws.data.roomId) {
    throw new Error("WebSocket connection missing roomId - client not properly joined to a room");
  }

  const room = globalManager.getRoom(ws.data.roomId);

  if (!room) {
    throw new Error(
      `Room ${ws.data.roomId} not found in global manager - room may have been cleaned up or never existed`
    );
  }

  return { room };
};

/**
 * All authenticated users in a room have full mutation rights.
 * Permission model: open — anyone who has joined a room can control playback,
 * queue, volume, and all other room actions.
 *
 * requireCanMutate is intentionally an alias for requireRoom.
 */
export const requireCanMutate = requireRoom;
