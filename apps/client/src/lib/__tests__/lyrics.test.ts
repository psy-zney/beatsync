import { describe, expect, it } from "bun:test";
import { MAX_LYRICS_BYTES, TrackLyricsSchema, WSRequestSchema, WSResponseSchema } from "@beatsync/shared";
import {
  buildLyricsQuery,
  findAutomaticLyrics,
  lyricsFromRecord,
  lyricsFromText,
  searchLyrics,
  type LyricsRecord,
} from "../lyrics";

const record: LyricsRecord = {
  id: 1,
  trackName: "Bài hát",
  artistName: "Ca sĩ",
  albumName: "Album",
  duration: 180,
  instrumental: false,
  syncedLyrics: "[00:05]Xin chào",
  plainLyrics: "Xin chào",
};

describe("lyrics selection and room protocol", () => {
  it("cleans video decoration but preserves remix/version information", () => {
    expect(buildLyricsQuery("Ca sĩ - Bài hát (Official Music Video).mp3")).toBe("Ca sĩ - Bài hát");
    expect(buildLyricsQuery("Artist - Song (Live Remix)")).toContain("Live Remix");
  });

  it("requires both artist and title plus compatible duration for automatic selection", () => {
    expect(findAutomaticLyrics([record], "Ca sĩ - Bài hát (Official Audio)", 182)).toEqual(record);
    expect(findAutomaticLyrics([record], "Bài hát", 180)).toBeUndefined();
    expect(findAutomaticLyrics([record], "Other artist - Bài hát", 180)).toBeUndefined();
    expect(findAutomaticLyrics([record], "Ca sĩ - Bài hát", 200)).toBeUndefined();
    expect(findAutomaticLyrics([record], "Ca sĩ - Bài hát", 0)).toBeUndefined();
  });

  it("supports timed imports and explicit unsynchronized text without duplicate payloads", () => {
    expect(lyricsFromText("[00:05]Xin chào").synced).toBe("[00:05]Xin chào");
    expect(lyricsFromText("Xin chào").plain).toBe("Xin chào");
    expect(lyricsFromRecord(record).plain).toBe("");
    expect(() => lyricsFromText("[00:99]Invalid")).toThrow("No valid lyric lines");
    expect(() => lyricsFromText(" ")).toThrow();
    expect(() => lyricsFromText("🎵".repeat(MAX_LYRICS_BYTES / 3))).toThrow();
    expect(TrackLyricsSchema.safeParse({ ...lyricsFromRecord(record), offset: Infinity }).success).toBe(false);
  });

  it("round trips shared lyric metadata and accepts removing it", () => {
    const lyrics = lyricsFromRecord(record);
    expect(
      WSRequestSchema.parse({ type: "SET_TRACK_LYRICS", audioSource: "track", lyrics, onlyIfEmpty: true }).type
    ).toBe("SET_TRACK_LYRICS");
    expect(WSRequestSchema.parse({ type: "SET_TRACK_LYRICS", audioSource: "track", lyrics: null }).type).toBe(
      "SET_TRACK_LYRICS"
    );
    const response = {
      type: "ROOM_EVENT" as const,
      event: { type: "SET_AUDIO_SOURCES" as const, sources: [{ url: "track", lyrics }] },
    };
    expect(WSResponseSchema.parse(response)).toEqual(response);
  });

  it("filters instrumental and malformed provider records", async () => {
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json([
        record,
        { ...record, instrumental: true },
        { id: 2 },
        { ...record, plainLyrics: null, syncedLyrics: null },
      ])) as unknown as typeof fetch;
    try {
      expect(await searchLyrics("song", new AbortController().signal)).toEqual([record]);
    } finally {
      globalThis.fetch = fetchMock;
    }
  });
});
