import play from "play-dl";

const YOUTUBE_PROXY_PATH = "/youtube/proxy";
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_REFRESH_BUFFER_MS = 60 * 1000;

interface CachedYoutubeStream {
  expiresAt: number;
  streamUrl: string;
  title: string;
}

const streamCache = new Map<string, CachedYoutubeStream>();
const inflightResolutions = new Map<string, Promise<CachedYoutubeStream>>();

function createWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function getCacheExpiry(streamUrl: string): number {
  try {
    const url = new URL(streamUrl);
    const expire = url.searchParams.get("expire");
    if (!expire) {
      return Date.now() + CACHE_TTL_MS;
    }

    const expireMs = Number(expire) * 1000;
    if (Number.isNaN(expireMs)) {
      return Date.now() + CACHE_TTL_MS;
    }

    return Math.max(Date.now() + 30_000, expireMs - CACHE_REFRESH_BUFFER_MS);
  } catch {
    return Date.now() + CACHE_TTL_MS;
  }
}

function getCachedStream(videoId: string): CachedYoutubeStream | null {
  const cached = streamCache.get(videoId);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    streamCache.delete(videoId);
    return null;
  }

  return cached;
}

function assertSupportedYoutubeUrl(url: string): void {
  const videoId = parseYoutubeVideoId(url);
  if (!videoId) {
    throw new Error("Invalid YouTube URL");
  }
}

function parseYoutubeVideoId(input: string): string | null {
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();

    if (hostname === "youtu.be") {
      const videoId = url.pathname.split("/").find(Boolean);
      return videoId ?? null;
    }

    if (hostname === "youtube.com" || hostname.endsWith(".youtube.com")) {
      const watchId = url.searchParams.get("v");
      if (watchId) {
        return watchId;
      }

      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length >= 2 && ["shorts", "embed", "live"].includes(segments[0])) {
        return segments[1];
      }
    }

    return null;
  } catch {
    return null;
  }
}

function pickAudioStreamUrl(
  formats: Partial<{ url: string; mimeType: string; audioQuality: string; bitrate: number }>[]
): string | null {
  const audioFormats = formats
    .filter((format) => format.url && ((format.mimeType?.includes("audio") ?? false) || format.audioQuality != null))
    .sort((left, right) => (left.bitrate ?? Number.MAX_SAFE_INTEGER) - (right.bitrate ?? Number.MAX_SAFE_INTEGER));

  return audioFormats[0]?.url ?? null;
}

export function getYoutubeVideoId(url: string): string {
  assertSupportedYoutubeUrl(url);
  return parseYoutubeVideoId(url)!;
}

export function buildYoutubeProxyUrl(videoId: string): string {
  return `${YOUTUBE_PROXY_PATH}?videoId=${encodeURIComponent(videoId)}`;
}

export async function getYoutubeMetadata(url: string): Promise<{ title: string; videoId: string }> {
  assertSupportedYoutubeUrl(url);
  const videoId = parseYoutubeVideoId(url)!;
  const cached = getCachedStream(videoId);

  if (cached) {
    return {
      title: cached.title,
      videoId,
    };
  }

  const info = await play.video_basic_info(url);
  return {
    title: info.video_details.title ?? "YouTube Audio",
    videoId,
  };
}

async function resolveYoutubeStream(videoId: string): Promise<CachedYoutubeStream> {
  const cached = getCachedStream(videoId);
  if (cached) {
    return cached;
  }

  const inflight = inflightResolutions.get(videoId);
  if (inflight) {
    return inflight;
  }

  const resolutionPromise = (async () => {
    const info = await play.video_info(createWatchUrl(videoId));
    const streamUrl = pickAudioStreamUrl(info.format);

    if (!streamUrl) {
      throw new Error("Failed to extract audio stream URL from YouTube link");
    }

    const resolved = {
      title: info.video_details.title ?? "YouTube Audio",
      streamUrl,
      expiresAt: getCacheExpiry(streamUrl),
    };

    streamCache.set(videoId, resolved);
    return resolved;
  })();

  inflightResolutions.set(videoId, resolutionPromise);

  try {
    return await resolutionPromise;
  } finally {
    inflightResolutions.delete(videoId);
  }
}

export async function getYoutubeStreamByVideoId(videoId: string): Promise<{ streamUrl: string; title: string }> {
  const resolved = await resolveYoutubeStream(videoId);
  return {
    streamUrl: resolved.streamUrl,
    title: resolved.title,
  };
}

export function isYoutubeProxyUrl(input: string): boolean {
  if (!input.startsWith("/")) {
    return false;
  }

  try {
    const url = new URL(input, "http://localhost");
    return url.pathname === YOUTUBE_PROXY_PATH;
  } catch {
    return false;
  }
}

export function isPersistentYoutubeProxyUrl(input: string): boolean {
  if (!isYoutubeProxyUrl(input)) {
    return false;
  }

  const url = new URL(input, "http://localhost");
  return Boolean(url.searchParams.get("videoId"));
}

export function isLegacyYoutubeProxyUrl(input: string): boolean {
  if (!isYoutubeProxyUrl(input)) {
    return false;
  }

  const url = new URL(input, "http://localhost");
  return Boolean(url.searchParams.get("url"));
}

export function isTrustedYoutubeMediaUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    return (
      hostname === "googlevideo.com" ||
      hostname.endsWith(".googlevideo.com") ||
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com") ||
      hostname === "youtu.be"
    );
  } catch {
    return false;
  }
}
