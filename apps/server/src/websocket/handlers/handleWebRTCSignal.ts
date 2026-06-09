import type { ExtractWSRequestFrom, WebRTCSignalUnicastType } from "@beatsync/shared";
import type { ClientActionEnum } from "@beatsync/shared";
import { globalManager } from "@/managers";
import { sendUnicast } from "@/utils/responses";
import type { ServerWebSocket } from "bun";
import type { BunServer, WSData } from "@/utils/websocket";

export function handleWebRTCSignal({
  ws,
  message,
}: {
  ws: ServerWebSocket<WSData>;
  message: ExtractWSRequestFrom[typeof ClientActionEnum.enum.WEBRTC_SIGNAL];
}) {
  const sourceClientId = ws.data.clientId;
  const targetClientId = message.targetClientId;
  const roomId = ws.data.roomId;

  const room = globalManager.getRoom(roomId);
  if (!room) {
    return;
  }

  // Find target client in the room
  const targetWs = room.getClientWs(targetClientId);
  if (!targetWs) {
    return;
  }

  // Forward the signaling message directly to the target client (Unicast)
  const broadcast: WebRTCSignalUnicastType = {
    type: "WEBRTC_SIGNAL",
    sourceClientId,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    signalData: message.signalData,
  };

  sendUnicast({
    ws: targetWs,
    message: broadcast,
  });
}
