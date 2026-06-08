import { describe, expect, it, mock } from "bun:test";
import {
  buildYoutubeProxyUrl,
  getYoutubeVideoId,
  isLegacyYoutubeProxyUrl,
  isPersistentYoutubeProxyUrl,
  isTrustedYoutubeMediaUrl,
  isYoutubeProxyUrl,
  parseYoutubeVideoId,
} from "@/lib/youtube";

// Mock youtube-ext
void mock.module("youtube-ext", () => {
  return {
    videoInfo: (url: string) => {
      if (url.includes("A86-yTr7fmE")) {
        return Promise.resolve({
          id: "A86-yTr7fmE",
          title: "Rap Việt Memory - NGTANOISE - Tlinh Cover",
          duration: { lengthSec: "184" },
          channel: { name: "NGTANOISE" },
          thumbnails: [{ url: "https://i.ytimg.com/vi/A86-yTr7fmE/hqdefault.jpg", width: 480, height: 360 }],
        });
      }
      return Promise.reject(new Error("Video not found"));
    },
    search: (_q: string) => {
      return Promise.resolve({
        videos: [
          {
            id: "A86-yTr7fmE",
            title: "Rap Việt Memory - NGTANOISE - Tlinh Cover",
            duration: { text: "3:04" },
            channel: { name: "NGTANOISE" },
            thumbnails: [{ url: "https://i.ytimg.com/vi/A86-yTr7fmE/hqdefault.jpg" }],
          },
        ],
      });
    },
  };
});

import { MusicProviderManager } from "@/managers/MusicProviderManager";

describe("YouTube URL helpers", () => {
  it("builds stable proxy URLs from video ids", () => {
    expect(buildYoutubeProxyUrl("dQw4w9WgXcQ")).toBe("/youtube/proxy?videoId=dQw4w9WgXcQ");
  });

  it("extracts the video id from supported URLs", () => {
    expect(getYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("detects persistent proxy URLs", () => {
    expect(isYoutubeProxyUrl("/youtube/proxy?videoId=dQw4w9WgXcQ")).toBe(true);
    expect(isPersistentYoutubeProxyUrl("/youtube/proxy?videoId=dQw4w9WgXcQ")).toBe(true);
    expect(isLegacyYoutubeProxyUrl("/youtube/proxy?videoId=dQw4w9WgXcQ")).toBe(false);
  });

  it("detects legacy proxy URLs", () => {
    expect(isYoutubeProxyUrl("/youtube/proxy?url=https%3A%2F%2Fr1.googlevideo.com%2Fvideoplayback")).toBe(true);
    expect(isLegacyYoutubeProxyUrl("/youtube/proxy?url=https%3A%2F%2Fr1.googlevideo.com%2Fvideoplayback")).toBe(true);
    expect(isPersistentYoutubeProxyUrl("/youtube/proxy?url=https%3A%2F%2Fr1.googlevideo.com%2Fvideoplayback")).toBe(
      false
    );
  });

  it("allows only trusted media hosts for direct proxying", () => {
    expect(isTrustedYoutubeMediaUrl("https://rr1---sn-abc.googlevideo.com/videoplayback?id=1")).toBe(true);
    expect(isTrustedYoutubeMediaUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isTrustedYoutubeMediaUrl("https://example.com/file.mp3")).toBe(false);
  });

  it("extracts ID using parseYoutubeVideoId correctly", () => {
    expect(parseYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYoutubeVideoId("not-a-url")).toBeNull();
  });
});

describe("MusicProviderManager Search", () => {
  it("returns single video metadata if search query is a YouTube URL", async () => {
    const manager = new MusicProviderManager();
    const result = await manager.search("https://www.youtube.com/watch?v=A86-yTr7fmE");
    expect(result.data.tracks.items).toHaveLength(1);
    expect(result.data.tracks.items[0].id).toBe("A86-yTr7fmE");
    expect(result.data.tracks.items[0].title).toBe("Rap Việt Memory - NGTANOISE - Tlinh Cover");
    expect(result.data.tracks.items[0].duration).toBe(184);
  });

  it("falls back to search when query is not a URL", async () => {
    const manager = new MusicProviderManager();
    const result = await manager.search("ngtanoise");
    expect(result.data.tracks.items).toHaveLength(1);
    expect(result.data.tracks.items[0].id).toBe("A86-yTr7fmE");
    expect(result.data.tracks.items[0].duration).toBe(184); // 3:04 is 184 seconds
  });
});
