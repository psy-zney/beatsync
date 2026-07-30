import { WSRequestType } from "@beatsync/shared";

export const sendWSRequest = ({ ws, request }: { ws: WebSocket; request: WSRequestType }): boolean => {
  if (ws.readyState !== WebSocket.OPEN) return false;

  try {
    ws.send(JSON.stringify(request));
    return true;
  } catch (error) {
    console.warn("WebSocket send skipped because the connection is unavailable", error);
    return false;
  }
};
