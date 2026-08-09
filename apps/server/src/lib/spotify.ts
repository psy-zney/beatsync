import { MUSIC_PROVIDER_MANAGER } from "@/managers/MusicProviderManager";
import pLimit from "p-limit";

export interface SpotifyTrackInfo {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  durationMs?: number;
}

export interface ResolvedSpotifyResult {
  title: string;
  type: "playlist" | "album" | "track";
  coverUrl?: string;
  tracks: {
    spotify: SpotifyTrackInfo;
    youtubeTrack: Record<string, unknown> | null;
  }[];
}

interface SpotifyApiArtist {
  name: string;
}

interface SpotifyApiImage {
  url: string;
}

interface SpotifyApiAlbum {
  name?: string;
  images?: SpotifyApiImage[];
}

interface SpotifyApiTrack {
  name: string;
  artists?: SpotifyApiArtist[];
  album?: SpotifyApiAlbum;
  duration_ms?: number;
}

interface SpotifyApiPlaylistResponse {
  name?: string;
  images?: SpotifyApiImage[];
  tracks?: {
    items?: {
      track?: SpotifyApiTrack;
    }[];
  };
}

interface SpotifyApiAlbumResponse {
  name?: string;
  images?: SpotifyApiImage[];
  artists?: SpotifyApiArtist[];
  tracks?: {
    items?: SpotifyApiTrack[];
  };
}

export function parseSpotifyUrl(urlInput: string): { type: "playlist" | "album" | "track"; id: string } | null {
  try {
    const url = new URL(urlInput.trim());
    if (!url.hostname.includes("spotify.com")) return null;

    const parts = url.pathname.split("/").filter(Boolean);
    const typeIndex = parts.findIndex((p) => ["playlist", "album", "track"].includes(p));
    if (typeIndex !== -1 && parts[typeIndex + 1]) {
      const type = parts[typeIndex] as "playlist" | "album" | "track";
      const id = parts[typeIndex + 1].split("?")[0];
      return { type, id };
    }
    return null;
  } catch {
    return null;
  }
}

let cachedSpotifyToken: { token: string; expiresAt: number } | null = null;

/**
 * Gets an official Spotify API Token if client credentials are provided in env, with in-memory caching
 */
async function getSpotifyApiToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (cachedSpotifyToken && Date.now() < cachedSpotifyToken.expiresAt) {
    return cachedSpotifyToken.token;
  }

  try {
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!res.ok) {
      console.warn(`[Tier 1] Spotify Token API returned HTTP ${res.status}. Falling back to Tier 2.`);
      return null;
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (data.access_token) {
      cachedSpotifyToken = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60000,
      };
      return data.access_token;
    }
    return null;
  } catch (err) {
    console.warn("[Tier 1] Spotify Token request failed:", err);
    return null;
  }
}

/**
 * Fetches Spotify metadata using a 3-Tier Fallback System:
 * - Tier 1: Official Spotify API (Client Credentials)
 * - Tier 2: Public Embed Scraper (__NEXT_DATA__ JSON payload)
 * - Tier 3: Public Spotify oEmbed API
 */
export async function fetchSpotifyTracks(
  spotifyUrl: string
): Promise<{ title: string; coverUrl?: string; tracks: SpotifyTrackInfo[] }> {
  const parsed = parseSpotifyUrl(spotifyUrl);
  if (!parsed) throw new Error("Invalid Spotify URL format.");

  const { type, id } = parsed;

  // ─────────────────────────────────────────────────────────
  // TIER 1: Official Spotify Web API (Client Credentials)
  // ─────────────────────────────────────────────────────────
  const token = await getSpotifyApiToken();
  if (token) {
    try {
      if (type === "track") {
        const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as SpotifyApiTrack;
          return {
            title: data.name,
            coverUrl: data.album?.images?.[0]?.url,
            tracks: [
              {
                title: data.name,
                artist: data.artists?.map((a) => a.name).join(", ") ?? "Unknown Artist",
                album: data.album?.name,
                coverUrl: data.album?.images?.[0]?.url,
                durationMs: data.duration_ms,
              },
            ],
          };
        }
        console.warn(`[Tier 1] Spotify API returned HTTP ${res.status}. Falling back to Tier 2.`);
      } else if (type === "playlist") {
        const res = await fetch(
          `https://api.spotify.com/v1/playlists/${id}?fields=name,images,tracks.items(track(name,artists,album,duration_ms))`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (res.ok) {
          const data = (await res.json()) as SpotifyApiPlaylistResponse;
          const tracks: SpotifyTrackInfo[] = (data.tracks?.items ?? [])
            .map((item) => item.track)
            .filter((t): t is SpotifyApiTrack => Boolean(t))
            .map((t) => ({
              title: t.name,
              artist: t.artists?.map((a) => a.name).join(", ") ?? "Unknown Artist",
              album: t.album?.name,
              coverUrl: t.album?.images?.[0]?.url,
              durationMs: t.duration_ms,
            }));
          return {
            title: data.name ?? "Spotify Playlist",
            coverUrl: data.images?.[0]?.url,
            tracks,
          };
        }
        console.warn(`[Tier 1] Spotify API returned HTTP ${res.status}. Falling back to Tier 2.`);
      } else if (type === "album") {
        const res = await fetch(`https://api.spotify.com/v1/albums/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as SpotifyApiAlbumResponse;
          const albumCover = data.images?.[0]?.url;
          const tracks: SpotifyTrackInfo[] = (data.tracks?.items ?? []).map((t) => ({
            title: t.name,
            artist:
              t.artists?.map((a) => a.name).join(", ") ??
              data.artists?.map((a) => a.name).join(", ") ??
              "Unknown Artist",
            album: data.name,
            coverUrl: albumCover,
            durationMs: t.duration_ms,
          }));
          return {
            title: data.name ?? "Spotify Album",
            coverUrl: albumCover,
            tracks,
          };
        }
        console.warn(`[Tier 1] Spotify API returned HTTP ${res.status}. Falling back to Tier 2.`);
      }
    } catch (err) {
      console.warn("[Tier 1] Spotify API fetch error, falling back to Tier 2:", err);
    }
  }

  // ─────────────────────────────────────────────────────────
  // TIER 2: Public Embed Scraper (__NEXT_DATA__ JSON Payload)
  // ─────────────────────────────────────────────────────────
  try {
    console.log(`[Tier 2] Trying Public Embed Scraper for Spotify URL (${type}:${id})...`);
    const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;
    const response = await fetch(embedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (response.ok) {
      const html = await response.text();
      const match = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
      if (match && match[1]) {
        const nextData = JSON.parse(match[1]) as {
          props?: { pageProps?: { state?: { data?: { entity?: Record<string, unknown> } } } };
        };
        const entity = nextData.props?.pageProps?.state?.data?.entity;
        if (entity) {
          const title = String(entity.name ?? entity.title ?? "Spotify Import");
          const coverUrl =
            (entity.images as SpotifyApiImage[])?.[0]?.url ??
            (entity.coverArt as { sources?: SpotifyApiImage[] })?.sources?.[0]?.url;

          let rawTracks: Record<string, unknown>[] = [];
          if (type === "track") {
            rawTracks = [entity];
          } else if (Array.isArray(entity.trackList)) {
            rawTracks = entity.trackList as Record<string, unknown>[];
          } else if ((entity.tracks as { items?: Record<string, unknown>[] })?.items) {
            rawTracks = (entity.tracks as { items: Record<string, unknown>[] }).items.map(
              (i) => (i.track as Record<string, unknown>) ?? i
            );
          }

          const tracks: SpotifyTrackInfo[] = rawTracks.map((t) => {
            const tName = String(t.name ?? t.title ?? "Unknown Track");
            const artistsArr =
              (t.artists as unknown[]) ?? (typeof t.subtitle === "string" ? t.subtitle.split(",") : []);
            const artistName = Array.isArray(artistsArr)
              ? artistsArr.map((a) => (typeof a === "string" ? a : (a as SpotifyApiArtist).name)).join(", ")
              : String(artistsArr);

            return {
              title: tName,
              artist: artistName || "Unknown Artist",
              album: (t.album as SpotifyApiAlbum)?.name,
              coverUrl: (t.album as SpotifyApiAlbum)?.images?.[0]?.url ?? coverUrl,
              durationMs: Number(t.durationMs ?? t.duration_ms ?? 0),
            };
          });

          if (tracks.length > 0) {
            return { title, coverUrl, tracks };
          }
        }
      }
    }
  } catch (err) {
    console.warn("[Tier 2] Public embed scraper failed, falling back to Tier 3:", err);
  }

  // ─────────────────────────────────────────────────────────
  // TIER 3: Spotify Public oEmbed API Fallback
  // ─────────────────────────────────────────────────────────
  console.log(`[Tier 3] Trying Spotify oEmbed API Fallback for URL: ${spotifyUrl}...`);
  const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`);
  if (oembedRes.ok) {
    const oembedData = (await oembedRes.json()) as { title?: string; thumbnail_url?: string };
    const fullTitle = oembedData.title ?? "Spotify Track";
    const parts = fullTitle.split(" by ");
    const songTitle = parts[0] ?? fullTitle;
    const songArtist = parts[1] ?? "Spotify";

    return {
      title: fullTitle,
      coverUrl: oembedData.thumbnail_url,
      tracks: [
        {
          title: songTitle,
          artist: songArtist,
          coverUrl: oembedData.thumbnail_url,
        },
      ],
    };
  }

  throw new Error("Could not parse Spotify playlist tracks with any of the 3 fallback tiers.");
}
