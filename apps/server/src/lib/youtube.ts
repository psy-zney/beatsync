import { join } from "path";

const YOUTUBE_PROXY_PATH = "/youtube/proxy";
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_REFRESH_BUFFER_MS = 60 * 1000;

interface CachedYoutubeStream {
  expiresAt: number;
  streamUrl: string;
  title: string;
}

export interface ResolvedYoutubeSource {
  videoId: string;
  title: string;
  streamUrl: string;
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

export function parseYoutubeVideoId(input: string): string | null {
  try {
    const trimmed = input.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      return trimmed;
    }

    const normalizedUrl =
      trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;

    const url = new URL(normalizedUrl);
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
      if (segments.length >= 2 && ["shorts", "embed", "live", "v"].includes(segments[0])) {
        return segments[1];
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function getYoutubeVideoId(url: string): string {
  assertSupportedYoutubeUrl(url);
  return parseYoutubeVideoId(url)!;
}

export function buildYoutubeProxyUrl(videoId: string): string {
  return `${YOUTUBE_PROXY_PATH}?videoId=${encodeURIComponent(videoId)}`;
}

export function needsYoutubeTitleHeal(source: { title?: string; url: string }): boolean {
  if (!source.url.includes("/youtube-cache/")) return false;
  if (!source.title?.trim()) return true;
  const title = source.title.trim();
  if (title === "YouTube Audio" || title === "YouTube" || title.startsWith("track-")) return true;
  if (/^[a-zA-Z0-9_-]{11}$/.test(title)) return true;
  const match = /\/youtube-cache\/([^.]+)\./.exec(source.url);
  if (match?.[1] && title === match[1]) return true;
  return false;
}

export async function getYoutubeMetadata(url: string): Promise<{ title: string; videoId: string }> {
  const videoId = parseYoutubeVideoId(url);
  if (!videoId) {
    throw new Error("Invalid YouTube URL");
  }

  // 1. Try lightning-fast official oEmbed API first (avoids stream extraction & rate limits)
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
    const res = await fetch(oembedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (res.ok) {
      const data = (await res.json()) as { title?: string };
      if (data.title?.trim()) {
        return { title: data.title.trim(), videoId };
      }
    }
  } catch {
    // Continue to HTML title fallback
  }

  // 2. Try fetching watch page HTML <title>
  try {
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (watchRes.ok) {
      const html = await watchRes.text();
      const titleMatch = /<title>([^<]+)<\/title>/i.exec(html);
      if (titleMatch?.[1]) {
        const cleanedTitle = titleMatch[1].replace(/\s*-\s*YouTube\s*$/i, "").trim();
        if (cleanedTitle && cleanedTitle !== "YouTube") {
          return { title: cleanedTitle, videoId };
        }
      }
    }
  } catch {
    // Continue to stream resolution fallback
  }

  // 3. Fallback to full stream resolution if needed
  const resolved = await resolveYoutubeStream(videoId);
  return {
    title: resolved.title,
    videoId,
  };
}

function findYtDlpBinary(): string {
  const isWindows = process.platform === "win32";
  const ytdlpName = isWindows ? "yt-dlp.exe" : "yt-dlp";
  const candidates = [
    join(process.cwd(), "node_modules", "youtube-dl-exec", "bin", ytdlpName),
    join(process.cwd(), "apps", "server", "node_modules", "youtube-dl-exec", "bin", ytdlpName),
    join(__dirname, "..", "..", "node_modules", "youtube-dl-exec", "bin", ytdlpName),
    ytdlpName,
  ];
  return candidates[0];
}

async function extractViaDirectYtDlp(
  videoId: string,
  extraArgs: string[] = []
): Promise<{ streamUrl: string; title: string }> {
  const ytdlpPath = findYtDlpBinary();
  const watchUrl = createWatchUrl(videoId);

  const args = ["--dump-json", "-f", "bestaudio/best", "--no-warnings", "--cookies", "/home/ubuntu/beatsync/cookies.txt", ...extraArgs, watchUrl];

  const proc = Bun.spawn([ytdlpPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`yt-dlp failed (code ${exitCode}): ${stderr || stdout}`);
  }

  const parsed = JSON.parse(stdout) as { url?: string; title?: string };
  const streamUrl = parsed.url;
  if (!streamUrl) {
    throw new Error("No stream URL found in yt-dlp output");
  }

  return {
    streamUrl,
    title: parsed.title ?? "YouTube Audio",
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
    const exeName = process.platform === "win32" ? "yt-rust-extractor.exe" : "yt-rust-extractor";
    const candidates = [
      join(process.cwd(), "yt-rust-extractor", "target", "release", exeName),
      join(process.cwd(), "apps", "server", "yt-rust-extractor", "target", "release", exeName),
      join(__dirname, "..", "..", "yt-rust-extractor", "target", "release", exeName),
      join(__dirname, "..", "yt-rust-extractor", "target", "release", exeName),
    ];

    let exePath: string | null = null;
    for (const candidate of candidates) {
      if (await Bun.file(candidate).exists()) {
        exePath = candidate;
        break;
      }
    }

    if (exePath) {
      try {
        const proc = Bun.spawn([exePath, createWatchUrl(videoId)], {
          stdout: "pipe",
          stderr: "pipe",
        });

        const stdout = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;

        if (exitCode === 0) {
          const parsed = JSON.parse(stdout) as { stream_url?: string; title?: string; error?: string };
          if (!parsed.error && parsed.stream_url) {
            const streamUrl = parsed.stream_url;
            const resolved = {
              title: parsed.title ?? "YouTube Audio",
              streamUrl,
              expiresAt: getCacheExpiry(streamUrl),
            };
            streamCache.set(videoId, resolved);
            return resolved;
          }
        }
      } catch {
        // Fallback below
      }
    }

    const fallbackStrategies = [
      ["--extractor-args", "youtube:player_client=ios,android,web"],
      ["--extractor-args", "youtube:player_client=android,web"],
      ["--extractor-args", "youtube:player_client=tv,web"],
      [],
    ];

    let lastError: Error | null = null;
    for (const strategy of fallbackStrategies) {
      try {
        const result = await extractViaDirectYtDlp(videoId, strategy);
        const resolved = {
          title: result.title,
          streamUrl: result.streamUrl,
          expiresAt: getCacheExpiry(result.streamUrl),
        };
        streamCache.set(videoId, resolved);
        return resolved;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError ?? new Error("Failed to extract YouTube stream after all fallbacks");
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

export async function resolveYoutubeSource(url: string): Promise<ResolvedYoutubeSource> {
  assertSupportedYoutubeUrl(url);
  const videoId = parseYoutubeVideoId(url)!;
  const resolved = await resolveYoutubeStream(videoId);

  return {
    videoId,
    title: resolved.title,
    streamUrl: resolved.streamUrl,
  };
}

export function invalidateYoutubeStream(videoId: string): void {
  streamCache.delete(videoId);
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
