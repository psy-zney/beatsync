import { resolveSpotifyPlaylist } from "@/lib/spotify";
import { errorResponse, jsonResponse } from "@/utils/responses";
import { z } from "zod";

const SpotifyResolveSchema = z.object({
  url: z.string().url(),
  maxTracks: z.number().int().min(1).max(100).optional().default(50),
});

export async function handleSpotifyResolve(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const body = await req.json();
    const { url, maxTracks } = SpotifyResolveSchema.parse(body);

    console.log(`Resolving Spotify playlist/album URL: ${url}`);
    const resolved = await resolveSpotifyPlaylist(url, maxTracks);

    return jsonResponse({
      success: true,
      data: resolved,
    });
  } catch (err) {
    console.error("Spotify resolve failed:", err);
    if (err instanceof z.ZodError) {
      return errorResponse("Invalid Spotify URL request payload", 400);
    }
    return errorResponse(err instanceof Error ? err.message : "Failed to resolve Spotify URL", 500);
  }
}
