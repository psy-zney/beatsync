import { fetchSpotifyTracks, parseSpotifyUrl } from "@/lib/spotify";
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

    console.log(`Fetching Spotify playlist/album URL: ${url}`);

    const parsed = parseSpotifyUrl(url);
    if (!parsed) throw new Error("Invalid Spotify URL");

    const meta = await fetchSpotifyTracks(url);

    // Return early without doing the heavy YouTube mapping
    return jsonResponse({
      success: true,
      data: {
        title: meta.title,
        type: parsed.type,
        coverUrl: meta.coverUrl,
        tracks: meta.tracks.slice(0, maxTracks),
      },
    });
  } catch (err) {
    console.error("Spotify resolve failed:", err);
    if (err instanceof z.ZodError) {
      return errorResponse("Invalid Spotify URL request payload", 400);
    }
    return errorResponse(err instanceof Error ? err.message : "Failed to resolve Spotify URL", 500);
  }
}
