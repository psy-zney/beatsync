import { AccessToken } from "livekit-server-sdk";
import { z } from "zod";
import { errorResponse, jsonResponse } from "@/utils/responses";

const VoiceTokenRequestSchema = z.object({
  roomId: z.string().regex(/^\d{6}$/),
  clientId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  username: z.string().trim().min(1).max(32),
});

/** Creates a short-lived, room-scoped LiveKit credential. Secrets never leave the server. */
export async function handleVoiceToken(req: Request): Promise<Response> {
  const livekitUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!livekitUrl || !apiKey || !apiSecret) {
    return errorResponse("Voice chat is not configured", 503);
  }

  try {
    const payload = VoiceTokenRequestSchema.parse(await req.json());
    const room = `beatsync-${payload.roomId}`;
    const token = new AccessToken(apiKey, apiSecret, {
      identity: payload.clientId,
      name: payload.username,
      ttl: "15m",
    });

    token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
    return jsonResponse({ serverUrl: livekitUrl, participantToken: await token.toJwt() });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse("Invalid voice token request", 400);
    console.error("Failed to create LiveKit token", error);
    return errorResponse("Failed to create voice token", 500);
  }
}
