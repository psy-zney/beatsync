import { parseSpotifyUrl } from "@/lib/spotify";
import { describe, expect, it, mock } from "bun:test";

// Mock MUSIC_PROVIDER_MANAGER.search to avoid hitting YouTube in tests
mock.module("@/managers/MusicProviderManager", () => ({
  MUSIC_PROVIDER_MANAGER: {
    search: async (query: string) => ({
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
    expect(parseSpotifyUrl("not-a-url")).toBeNull();
  });
});
