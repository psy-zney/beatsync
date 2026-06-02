import { globalManager } from "@/managers/GlobalManager";
import {
  buildYoutubeProxyUrl,
  getYoutubeStreamByVideoId,
  invalidateYoutubeStream,
  isTrustedYoutubeMediaUrl,
  resolveYoutubeSource,
} from "@/lib/youtube";
import { objectExists, uploadBytesToKey, getPublicUrlForKey } from "@/lib/r2";
import { errorResponse, jsonResponse, sendBroadcast } from "@/utils/responses";
import type { BunServer } from "@/utils/websocket";
import { z } from "zod";

const YoutubeUploadSchema = z.object({
  roomId: z.string(),
  url: z.string().url(),
});

const activeYoutubeCacheJobs = new Map<string, Promise<string>>();

function getExtensionFromContentType(contentType: string): string {
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("mp4")) return "m4a";
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("ogg")) return "ogg";
  return "bin";
}

function createYoutubeCacheKey(videoId: string, contentType: string): string {
  return `youtube-cache/${videoId}.${getExtensionFromContentType(contentType)}`;
}

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

async function ensureYoutubeAudioCached({
  videoId,
  title,
  initialStreamUrl,
}: {
  videoId: string;
  title: string;
  initialStreamUrl?: string;
}): Promise<string> {
  const cachedUrl = await findCachedYoutubeAudioUrl(videoId);
  if (cachedUrl) {
    return cachedUrl;
  }

  const inflight = activeYoutubeCacheJobs.get(videoId);
  if (inflight) {
    return inflight;
  }

  const cachePromise = (async () => {
    const streamUrl = initialStreamUrl ?? (await getYoutubeStreamByVideoId(videoId)).streamUrl;
    const response = await fetch(streamUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
        Origin: "https://www.youtube.com",
        Referer: "https://www.youtube.com/",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`Failed to download YouTube audio for caching: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "audio/webm";
    const key = createYoutubeCacheKey(videoId, contentType);
    if (await objectExists(key)) {
      return getPublicUrlForKey(key);
    }

    const arrayBuffer = await response.arrayBuffer();
    const cachedUrlAfterDownload = await findCachedYoutubeAudioUrl(videoId);
    if (cachedUrlAfterDownload) {
      return cachedUrlAfterDownload;
    }

    const cachedUrl = await uploadBytesToKey(arrayBuffer, key, contentType);
    console.log(`Cached YouTube audio: ${videoId} (${title}) -> ${cachedUrl}`);
    return cachedUrl;
  })();

  activeYoutubeCacheJobs.set(videoId, cachePromise);

  try {
    return await cachePromise;
  } finally {
    activeYoutubeCacheJobs.delete(videoId);
  }
}

const cacheYoutubeAudioForRoom = async ({
  roomId,
  videoId,
  sourceUrl,
  title,
  initialStreamUrl,
  server,
}: {
  roomId: string;
  videoId: string;
  sourceUrl: string;
  title: string;
  initialStreamUrl?: string;
  server: BunServer;
}) => {
  try {
    const room = globalManager.getRoom(roomId);
    if (!room) return;
    const cachedUrl = await ensureYoutubeAudioCached({
      videoId,
      title,
      initialStreamUrl,
    });

    const updatedSources = room.replaceAudioSource(sourceUrl, {
      url: cachedUrl,
      title,
    });

    sendBroadcast({
      server,
      roomId,
      message: {
        type: "ROOM_EVENT",
        event: {
          type: "SET_AUDIO_SOURCES",
          sources: updatedSources,
          currentAudioSource: room.getPlaybackState().audioSource || undefined,
        },
      },
    });

    console.log(`Bound cached YouTube audio into room ${roomId}: ${videoId} -> ${cachedUrl}`);
  } catch (error) {
    console.error(`YouTube cache job failed for room ${roomId}, video ${videoId}:`, error);
    invalidateYoutubeStream(videoId);
  }
};

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

    const { title, videoId, streamUrl } = await resolveYoutubeSource(url);
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

    if (!cachedUrl) {
      void cacheYoutubeAudioForRoom({
        roomId,
        videoId,
        sourceUrl,
        title,
        initialStreamUrl: streamUrl,
        server,
      });
    }

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
