import type { ExtractWSRequestFrom } from "@beatsync/shared";
import type { HandlerFunction } from "@/websocket/types";
import { requireRoom } from "@/websocket/middlewares";
import { sendUnicast } from "@/utils/responses";

export const handleWebRTCSignal: HandlerFunction<ExtractWSRequestFrom["WEBRTC_SIGNAL"]> = ({ ws, message }) => {
  const { room } = requireRoom(ws);

  // Find the target client's WebSocket connection
  const targetWs = room.getClientWs(message.targetClientId);

  if (!targetWs) {
    console.warn(`[WebRTC] Target client ${message.targetClientId} not connected in room ${room.getRoomId()}`);
    return;
  }

  // Forward the signal to the target client using sendUnicast
  sendUnicast({
    ws: targetWs,
    message: {
      type: "WEBRTC_SIGNAL",
      sourceClientId: ws.data.clientId,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      signal: message.signal,
    },
  });
};
