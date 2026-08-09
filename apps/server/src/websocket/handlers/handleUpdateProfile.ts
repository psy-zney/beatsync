import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { sendBroadcast } from "@/utils/responses";
import { requireRoom } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";

export const handleUpdateProfile: HandlerFunction<ExtractWSRequestFrom["UPDATE_PROFILE"]> = ({
  ws,
  message,
  server,
}) => {
  const { room } = requireRoom(ws);
  if (!room.updateClientAvatar(ws.data.clientId, message.avatar)) return;

  sendBroadcast({
    server,
    roomId: ws.data.roomId,
    message: {
      type: "ROOM_EVENT",
      event: { type: "CLIENT_CHANGE", clients: room.getClients() },
    },
  });
};
