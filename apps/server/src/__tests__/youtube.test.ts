import { describe, expect, it } from "bun:test";
import {
  buildYoutubeProxyUrl,
  getYoutubeVideoId,
  isLegacyYoutubeProxyUrl,
  isPersistentYoutubeProxyUrl,
  isTrustedYoutubeMediaUrl,
  isYoutubeProxyUrl,
} from "@/lib/youtube";

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
});
