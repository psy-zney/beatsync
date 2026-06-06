import { globalManager } from "@/managers/GlobalManager";
import {
  buildYoutubeProxyUrl,
  getYoutubeStreamByVideoId,
  invalidateYoutubeStream,
  isTrustedYoutubeMediaUrl,
  resolveYoutubeSource,
} from "@/lib/youtube";
import { getPublicUrlForKey, objectExists } from "@/lib/r2";
import { errorResponse, jsonResponse, sendBroadcast } from "@/utils/responses";
import type { BunServer } from "@/utils/websocket";
import { z } from "zod";

const YoutubeUploadSchema = z.object({
  roomId: z.string(),
  url: z.string().url(),
});

async function findCachedYoutubeAudioUrl(videoId: string): Promise<string | null> {
  const candidateKeys = [
    `youtube-cache/${videoId}.webm`,
    `youtube-cache/${videoId}.m4a`,
    `youtube-cache/${videoId}.mp3`,
    `youtube-cache/${videoId}.ogg`,
  ];

  for (const key of candidateKeys) {
    if (await objectExists(key)) {
      return getPublicUrlForKey(key);
    }
  }

  return null;
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

    const { title, videoId } = await resolveYoutubeSource(url);
    const cachedUrl = await findCachedYoutubeAudioUrl(videoId);
    const sourceUrl = cachedUrl ?? buildYoutubeProxyUrl(videoId);

    // Add to room
    const sources = room.addAudioSource({
      url: sourceUrl,
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

    // We skip caching to MinIO entirely. We let the client proxy it natively to support HTTP ranges flawlessly.

    return jsonResponse({ success: true, title, publicUrl: sourceUrl });
  } catch (error) {
    console.error("YouTube upload error:", error);
    return errorResponse(error instanceof Error ? error.message : "Failed to process YouTube link", 500);
  }
};

export const handleYoutubeProxy = async (req: Request) => {
  const url = new URL(req.url);
  const videoId = url.searchParams.get("videoId");
  let targetUrl = url.searchParams.get("url");

  if (videoId) {
    try {
      const resolved = await getYoutubeStreamByVideoId(videoId);
      targetUrl = resolved.streamUrl;
    } catch (error) {
      console.error(`YouTube stream resolution error for video ${videoId}:`, error);
      return errorResponse(error instanceof Error ? error.message : "Failed to resolve YouTube stream", 500);
    }
  }

  if (!targetUrl) {
    return errorResponse("Missing 'videoId' or 'url' parameter", 400);
  }

  if (!isTrustedYoutubeMediaUrl(targetUrl)) {
    return errorResponse("Untrusted proxy target", 400);
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
    headersToSend.set("Accept", "*/*");
    headersToSend.set("Origin", "https://www.youtube.com");
    headersToSend.set("Referer", "https://www.youtube.com/");

    let response = await fetch(targetUrl, {
      headers: headersToSend,
      redirect: "follow",
    });

    if (videoId && response.status === 403) {
      invalidateYoutubeStream(videoId);
      const refreshed = await getYoutubeStreamByVideoId(videoId);
      response = await fetch(refreshed.streamUrl, {
        headers: headersToSend,
        redirect: "follow",
      });
    }

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

    if (!response.ok) {
      const errorText = await response.text();
      console.error("YouTube upstream proxy failure:", {
        status: response.status,
        videoId,
        targetUrl,
        errorText: errorText.slice(0, 500),
      });

      return new Response(errorText || "Failed to proxy YouTube stream", {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

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
