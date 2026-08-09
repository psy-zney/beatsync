import { fetchSpotifyTracks, parseSpotifyUrl } from "@/lib/spotify";
import { describe, expect, it, mock } from "bun:test";

// Mock MUSIC_PROVIDER_MANAGER.search to avoid hitting YouTube in tests
void mock.module("@/managers/MusicProviderManager", () => ({
  MUSIC_PROVIDER_MANAGER: {
    search: (query: string) =>
      Promise.resolve({
        data: {
          tracks: {
            items: [
              {
                id: "mock_yt_id",
                title: query,
                performer: { name: "Mock Artist" },
              },
            ],
          },
        },
      }),
  },
}));

describe("Spotify URL Helpers & Resolution", () => {
  it("correctly parses playlist, album, and track URLs", () => {
    expect(parseSpotifyUrl("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")).toEqual({
      type: "playlist",
      id: "37i9dQZF1DXcBWIGoYBM5M",
    });

    expect(parseSpotifyUrl("https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy?si=123")).toEqual({
      type: "album",
      id: "4aawyAB9vmqN3uQ7FjRGTy",
    });

    expect(parseSpotifyUrl("https://open.spotify.com/track/0VjDiYV9D9bGBwSuYWRSbM")).toEqual({
      type: "track",
      id: "0VjDiYV9D9bGBwSuYWRSbM",
    });

    expect(parseSpotifyUrl("https://youtube.com/watch?v=123")).toBeNull();
    expect(parseSpotifyUrl("https://spotify.com.evil.example/playlist/fake")).toBeNull();
    expect(parseSpotifyUrl("not-a-url")).toBeNull();
  });

  it("follows Spotify pagination up to the requested track limit", async () => {
    const originalFetch = globalThis.fetch;
    process.env.SPOTIFY_CLIENT_ID = "test-client";
    process.env.SPOTIFY_CLIENT_SECRET = "test-secret";

    const track = (name: string) => ({ name, artists: [{ name: "Artist" }], duration_ms: 1000 });
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://accounts.spotify.com/api/token") {
        return Promise.resolve(Response.json({ access_token: "test-token", expires_in: 3600 }));
      }
      if (url.includes("offset=2")) {
        return Promise.resolve(
          Response.json({ items: [{ track: track("Three") }, { track: track("Four") }], next: null })
        );
      }
      if (url.startsWith("https://api.spotify.com/v1/playlists/playlist-id")) {
        return Promise.resolve(
          Response.json({
            name: "Long playlist",
            tracks: {
              items: [{ track: track("One") }, { track: track("Two") }],
              next: "https://api.spotify.com/v1/playlists/playlist-id/tracks?offset=2&limit=2",
            },
          })
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }) as unknown as typeof fetch;

    try {
      const result = await fetchSpotifyTracks("https://open.spotify.com/playlist/playlist-id", 3);
      expect(result.tracks.map((item) => item.title)).toEqual(["One", "Two", "Three"]);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.SPOTIFY_CLIENT_ID;
      delete process.env.SPOTIFY_CLIENT_SECRET;
    }
  });
});
