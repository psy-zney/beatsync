import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  LIBRARY_KEY,
  RECENT_ROOMS_KEY,
  compactTrackUrl,
  parseSavedPlaylists,
  readRecentRooms,
  readSavedPlaylists,
  rememberRecentRoom,
  saveBrowserPlaylist,
  deleteBrowserPlaylist,
} from "../browserLibrary";
import { generateRoomId } from "../room";

const originalWindow = globalThis.window;
const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
};
beforeEach(() => {
  values.clear();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, dispatchEvent: () => true },
  });
});
afterAll(() => Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow }));

describe("browser playlist library", () => {
  it("round trips Unicode titles and compact stable YouTube references without audio data", () => {
    saveBrowserPlaylist("123456", [
      { url: "https://cdn.test/youtube-cache/dQw4w9WgXcQ.webm", title: "Nhạc cùng nhau 🎧" },
    ]);
    expect(values.get(LIBRARY_KEY)).toContain('"dQw4w9WgXcQ"');
    expect(values.get(LIBRARY_KEY)).not.toContain("cdn.test");
    expect(readSavedPlaylists()[0].tracks).toEqual([
      { url: "/youtube/proxy?videoId=dQw4w9WgXcQ", title: "Nhạc cùng nhau 🎧" },
    ]);
    expect(compactTrackUrl("https://cdn.test/room-123456/upload.mp3")).toBe("https://cdn.test/room-123456/upload.mp3");
  });

  it("replaces a saved room list and keeps independent room playlists", () => {
    saveBrowserPlaylist("123456", [{ url: "/youtube/proxy?videoId=dQw4w9WgXcQ", title: "First" }]);
    saveBrowserPlaylist("654321", [{ url: "https://cdn.test/default/test.mp3" }]);
    saveBrowserPlaylist("123456", [{ url: "/youtube/proxy?videoId=dQw4w9WgXcQ", title: "Updated" }]);
    expect(readSavedPlaylists().map((list) => list.roomId)).toEqual(["123456", "654321"]);
    expect(readSavedPlaylists()[0].tracks[0].title).toBe("Updated");
    deleteBrowserPlaylist("123456");
    expect(readSavedPlaylists().map((list) => list.roomId)).toEqual(["654321"]);
  });

  it("tolerates corrupted storage and ignores invalid or duplicate records", () => {
    expect(parseSavedPlaylists("{broken")).toEqual([]);
    expect(
      parseSavedPlaylists(
        JSON.stringify([
          ["invalid", 1, [["url", "title"]]],
          [
            "123456",
            1,
            [
              ["", "bad"],
              ["dQw4w9WgXcQ", "Good"],
              ["dQw4w9WgXcQ", "Duplicate"],
            ],
          ],
          ["123456", 2, [["url", "Duplicate playlist"]]],
        ])
      )
    ).toEqual([
      { roomId: "123456", savedAt: 1, tracks: [{ url: "/youtube/proxy?videoId=dQw4w9WgXcQ", title: "Good" }] },
    ]);
  });

  it("keeps a bounded library and rejects oversized lists without overwriting saved data", () => {
    for (let i = 0; i < 20; i++)
      saveBrowserPlaylist(String(i).padStart(6, "0"), [{ url: "https://cdn.test/default/test.mp3" }]);
    expect(readSavedPlaylists()).toHaveLength(20);
    const oldValue = values.get(LIBRARY_KEY);
    expect(() => saveBrowserPlaylist("123456", [{ url: "https://cdn.test/new.mp3" }])).toThrow("20 playlist");
    expect(() =>
      saveBrowserPlaylist(
        "123456",
        Array.from({ length: 501 }, (_, i) => ({ url: `url-${i}` }))
      )
    ).toThrow();
    expect(values.get(LIBRARY_KEY)).toBe(oldValue);
  });

  it("reports quota failures without losing previous playlists", () => {
    saveBrowserPlaylist("123456", [{ url: "https://cdn.test/default/test.mp3" }]);
    const oldValue = values.get(LIBRARY_KEY);
    const originalSetItem = storage.setItem;
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      expect(() => saveBrowserPlaylist("654321", [{ url: "https://cdn.test/default/other.mp3" }])).toThrow(
        "QuotaExceededError"
      );
      expect(values.get(LIBRARY_KEY)).toBe(oldValue);
      expect(() => rememberRecentRoom("654321")).not.toThrow();
    } finally {
      storage.setItem = originalSetItem;
    }
  });

  it("remembers the six most recent valid rooms, including leading zeroes", () => {
    values.set(RECENT_ROOMS_KEY, "{broken");
    expect(readRecentRooms()).toEqual([]);
    for (const id of ["090624", "000001", "000002", "000003", "000004", "000005", "000006", "000001", "bad"])
      rememberRecentRoom(id);
    expect(readRecentRooms()).toEqual(["000001", "000006", "000005", "000004", "000003", "000002"]);
  });

  it("generates valid room codes outside the reserved and excluded rooms", () => {
    for (let i = 0; i < 30; i++) {
      const id = generateRoomId(["123456", "000000"]);
      expect(id).toMatch(/^\d{6}$/);
      expect(["090624", "123456", "000000"]).not.toContain(id);
    }
  });
});
