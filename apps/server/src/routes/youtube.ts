import { globalManager } from "@/managers/GlobalManager";
import { errorResponse, jsonResponse, sendBroadcast } from "@/utils/responses";
import type { BunServer } from "@/utils/websocket";
import youtubedl from "youtube-dl-exec";
import { z } from "zod";

const YoutubeUploadSchema = z.object({
  roomId: z.string(),
  url: z.string().url(),
});

interface YoutubeDlOutput {
  title?: string;
  url?: string;
}

export const handleYoutubeUpload = async (req: Request, server: BunServer) => {
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const body = (await req.json()) as unknown;
    const parsed = YoutubeUploadSchema.safeParse(body);

    if (!parsed.success) {
      return errorResponse("Invalid request body format", 400);
    }

    const { roomId, url } = parsed.data;

    const room = globalManager.getRoom(roomId);
    if (!room) {
      return errorResponse("Room not found", 404);
    }

    // Get video info and stream URL via yt-dlp
    const output = (await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      callHome: false,
      noCheckCertificates: true,
      format: "worstaudio",
    })) as unknown as YoutubeDlOutput;

    const title = output.title ?? "YouTube Audio";
    const publicUrl = output.url; // Use direct stream URL, bypassing S3

    if (!publicUrl) {
      return errorResponse("Failed to extract audio stream URL from YouTube link", 400);
    }

    // Format the URL to go through our local server proxy to bypass browser CORS
    const proxiedUrl = `/youtube/proxy?url=${encodeURIComponent(publicUrl)}`;

    // Add to room
    const sources = room.addAudioSource({
      url: proxiedUrl,
      title,
    });

    sendBroadcast({
      server,
      roomId,
      message: {
        type: "ROOM_EVENT",
        event: {
          type: "SET_AUDIO_SOURCES",
          sources,
        },
      },
    });

    return jsonResponse({ success: true, title, publicUrl: proxiedUrl });
  } catch (error) {
    console.error("YouTube upload error:", error);
    return errorResponse(error instanceof Error ? error.message : "Failed to process YouTube link", 500);
  }
};

export const handleYoutubeProxy = async (req: Request) => {
  const url = new URL(req.url);
  const targetUrl = url.searchParams.get("url");

  if (!targetUrl) {
    return errorResponse("Missing 'url' parameter", 400);
  }

  try {
    const headersToSend = new Headers();
    const range = req.headers.get("range");
    if (range) {
      headersToSend.set("range", range);
    }
    headersToSend.set(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    const response = await fetch(targetUrl, {
      headers: headersToSend,
    });

    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "*");
    headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type");

    const contentType = response.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);

    const contentLength = response.headers.get("content-length");
    if (contentLength) headers.set("content-length", contentLength);

    const contentRange = response.headers.get("content-range");
    if (contentRange) headers.set("content-range", contentRange);

    const acceptRanges = response.headers.get("accept-ranges");
    if (acceptRanges) headers.set("accept-ranges", acceptRanges);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error("YouTube proxy error:", error);
    return errorResponse(error instanceof Error ? error.message : "Failed to proxy YouTube stream", 500);
  }
};
