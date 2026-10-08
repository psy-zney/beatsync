import { expect, test } from "bun:test";
import { WSResponseSchema, type AudioSourceType, type TrackLyricsUpdateType } from "@beatsync/shared";
import { mergeLyricsUpdate } from "../lyricsUpdates";
import { getLyricsLines, getCurrentLineIndex } from "../lrc";

test("late automatic updates cannot overwrite newer manual offsets or unrelated tracks", () => {
  const source: AudioSourceType = {
    url: "track",
    lyricsVersion: 8,
    lyrics: { synced: "[00:01]Manual", plain: "", offset: 0.5, provider: "import" },
  };
  const stale: TrackLyricsUpdateType = {
    type: "TRACK_LYRICS_UPDATE",
    audioSource: "track",
    lyrics: null,
    lyricsState: "not_found",
    lyricsVersion: 7,
  };
  expect(mergeLyricsUpdate(source, stale)).toBe(source);
  expect(mergeLyricsUpdate(source, { ...stale, audioSource: "other", lyricsVersion: 9 })).toBe(source);
  expect(mergeLyricsUpdate(source, { ...stale, lyricsVersion: 9, lyricsState: "" }).lyrics).toBeUndefined();
});

test("structured word timing reaches karaoke through the room protocol", () => {
  const lyrics = {
    synced: "",
    plain: "",
    offset: 0,
    provider: "youtube-manual" as const,
    language: "vi",
    syncType: "word" as const,
    lines: [
      {
        startTime: 1,
        endTime: 3,
        text: "Xin chào",
        words: [
          { startTime: 1, endTime: 2, text: "Xin " },
          { startTime: 2, endTime: 3, text: "chào" },
        ],
      },
    ],
  };
  const update: TrackLyricsUpdateType = {
    type: "TRACK_LYRICS_UPDATE",
    audioSource: "track",
    lyrics,
    lyricsState: "ready",
    lyricsVersion: 3,
  };
  expect(WSResponseSchema.safeParse({ type: "ROOM_EVENT", event: update }).success).toBe(true);
  const lines = getLyricsLines(mergeLyricsUpdate({ url: "track" }, update).lyrics);
  expect(lines[0].words?.[1].startTime).toBe(2);
  expect(getCurrentLineIndex({ lines, timeSeconds: 3 })).toBe(-1);
  expect(
    WSResponseSchema.safeParse({
      type: "ROOM_EVENT",
      event: { ...update, lyrics: { ...lyrics, lines: [{ ...lyrics.lines[0], endTime: 0 }] } },
    }).success
  ).toBe(false);
});
