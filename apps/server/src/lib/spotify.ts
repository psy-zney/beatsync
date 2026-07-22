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
    youtubeTrack: any | null; // Mapped track from MusicProviderManager
  }[];
}

export function parseSpotifyUrl(urlInput: string): { type: "playlist" | "album" | "track"; id: string } | null {
  try {
    const url = new URL(urlInput.trim());
    if (!url.hostname.includes("spotify.com")) return null;

    const parts = url.pathname.split("/").filter(Boolean);
    // e.g. /playlist/37i9dQZF1DXcBWIGoYBM5M or /intl-vi/playlist/37i9dQZF1DXcBWIGoYBM5M
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

/**
 * Gets an official Spotify API Token if client credentials are provided in env
 */
async function getSpotifyApiToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

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

    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch (err) {
    console.warn("Spotify token request failed:", err);
    return null;
  }
}

/**
 * Fetches Spotify metadata via official API if credentials exist, or public embed scraper
 */
export async function fetchSpotifyTracks(
  spotifyUrl: string
): Promise<{ title: string; coverUrl?: string; tracks: SpotifyTrackInfo[] }> {
  const parsed = parseSpotifyUrl(spotifyUrl);
  if (!parsed) throw new Error("Invalid Spotify URL format.");

  const { type, id } = parsed;

  // 1. Try Official Spotify API if env token is available
  const token = await getSpotifyApiToken();
  if (token) {
    try {
      if (type === "track") {
        const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json());
          return {
            title: data.name,
            coverUrl: data.album?.images?.[0]?.url,
            tracks: [
              {
                title: data.name,
                artist: data.artists?.map((a: any) => a.name).join(", ") || "Unknown Artist",
                album: data.album?.name,
                coverUrl: data.album?.images?.[0]?.url,
                durationMs: data.duration_ms,
              },
            ],
          };
        }
      } else if (type === "playlist") {
        const res = await fetch(
          `https://api.spotify.com/v1/playlists/${id}?fields=name,images,tracks.items(track(name,artists,album,duration_ms))`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (res.ok) {
          const data = (await res.json());
          const tracks: SpotifyTrackInfo[] = (data.tracks?.items || [])
            .map((item: any) => item.track)
            .filter(Boolean)
            .map((t: any) => ({
              title: t.name,
              artist: t.artists?.map((a: any) => a.name).join(", ") || "Unknown Artist",
              album: t.album?.name,
              coverUrl: t.album?.images?.[0]?.url,
              durationMs: t.duration_ms,
            }));
          return {
            title: data.name || "Spotify Playlist",
            coverUrl: data.images?.[0]?.url,
            tracks,
          };
        }
      } else if (type === "album") {
        const res = await fetch(`https://api.spotify.com/v1/albums/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json());
          const albumCover = data.images?.[0]?.url;
          const tracks: SpotifyTrackInfo[] = (data.tracks?.items || []).map((t: any) => ({
            title: t.name,
            artist:
              t.artists?.map((a: any) => a.name).join(", ") ||
              data.artists?.map((a: any) => a.name).join(", ") ||
              "Unknown Artist",
            album: data.name,
            coverUrl: albumCover,
            durationMs: t.duration_ms,
          }));
          return {
            title: data.name || "Spotify Album",
            coverUrl: albumCover,
            tracks,
          };
        }
      }
    } catch (err) {
      console.warn("Official Spotify API fetch error, falling back to public scraper:", err);
    }
  }

  // 2. Fallback: Public Embed Scraper (No API Key Required)
  const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;
  const response = await fetch(embedUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Spotify metadata (HTTP ${response.status})`);
  }

  const html = await response.text();

  // Try extracting __NEXT_DATA__ script payload
  const match = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s.exec(html);
  if (match && match[1]) {
    try {
      const nextData = JSON.parse(match[1]);
      const entity = nextData.props?.pageProps?.state?.data?.entity;
      if (entity) {
        const title = entity.name || entity.title || "Spotify Import";
        const coverUrl = entity.images?.[0]?.url || entity.coverArt?.sources?.[0]?.url;

        let rawTracks: any[] = [];
        if (type === "track") {
          rawTracks = [entity];
        } else if (entity.trackList) {
          rawTracks = entity.trackList;
        } else if (entity.tracks?.items) {
          rawTracks = entity.tracks.items.map((i: any) => i.track || i);
        }

        const tracks: SpotifyTrackInfo[] = rawTracks.map((t: any) => {
          const tName = t.name || t.title || "Unknown Track";
          const artistsArr = t.artists || t.subtitle?.split(",") || [];
          const artistName = Array.isArray(artistsArr)
            ? artistsArr.map((a: any) => (typeof a === "string" ? a : a.name)).join(", ")
            : String(artistsArr);

          return {
            title: tName,
            artist: artistName || "Unknown Artist",
            album: t.album?.name,
            coverUrl: t.album?.images?.[0]?.url || coverUrl,
            durationMs: t.durationMs || t.duration_ms,
          };
        });

        if (tracks.length > 0) {
          return { title, coverUrl, tracks };
        }
      }
    } catch (e) {
      console.warn("Failed to parse Spotify __NEXT_DATA__:", e);
    }
  }

  // Fallback 3: Parse oEmbed API
  const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`);
  if (oembedRes.ok) {
    const oembedData = (await oembedRes.json()) as { title?: string; thumbnail_url?: string };
    const fullTitle = oembedData.title || "Spotify Track";
    // Title format often is "Song Title by Artist"
    const parts = fullTitle.split(" by ");
    const songTitle = parts[0] || fullTitle;
    const songArtist = parts[1] || "Spotify";

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

  throw new Error("Could not parse Spotify playlist tracks.");
}

/**
 * Resolves a Spotify playlist URL and maps each track to YouTube Stream Item
 */
export async function resolveSpotifyPlaylist(spotifyUrl: string, maxTracks = 50): Promise<ResolvedSpotifyResult> {
  const parsed = parseSpotifyUrl(spotifyUrl);
  if (!parsed) throw new Error("Invalid Spotify link");

  const meta = await fetchSpotifyTracks(spotifyUrl);
  const selectedTracks = meta.tracks.slice(0, maxTracks);

  const limit = pLimit(3); // Limit concurrency to 3 to prevent rate limits
  const mapped = await Promise.all(
    selectedTracks.map((spotTrack) =>
      limit(async () => {
        try {
          const query = `${spotTrack.title} ${spotTrack.artist}`;
          const searchResult = await MUSIC_PROVIDER_MANAGER.search(query, 0);
          const firstItem = searchResult.data.tracks.items[0] ?? null;
          return {
            spotify: spotTrack,
            youtubeTrack: firstItem,
          };
        } catch (err) {
          console.warn(`Failed to resolve YouTube track for "${spotTrack.title} ${spotTrack.artist}":`, err);
          return {
            spotify: spotTrack,
            youtubeTrack: null,
          };
        }
      })
    )
  );

  return {
    title: meta.title,
    type: parsed.type,
    coverUrl: meta.coverUrl,
    tracks: mapped,
  };
}
