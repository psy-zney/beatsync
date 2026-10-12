import { describe, expect, it } from "bun:test";
import { PlayActionSchema } from "@beatsync/shared";
import { getPlaybackWindow, planAudioPreload, trimAudioCache } from "../audioPreload";

const source = (url: string, status: "idle" | "loaded" | "loading" | "error") => ({ source: { url }, status });

describe("automatic continuation preloading", () => {
  it("loads the successor of the playing track instead of restarting from the playlist head", () => {
    const plan = planAudioPreload(
      [source("a", "idle"), source("b", "loaded"), source("c", "idle"), source("d", "idle")],
      "b",
      ["b"],
      3,
      1
    );
    expect(plan).toEqual({ loadUrl: "c", evictedUrls: [] });
  });

  it("makes room for the successor when all three cache slots contain earlier tracks", () => {
    const plan = planAudioPreload(
      [source("a", "loaded"), source("b", "loaded"), source("c", "loaded"), source("d", "idle"), source("e", "idle")],
      "c",
      ["c", "b", "a"],
      3,
      1
    );
    expect(plan).toEqual({ loadUrl: "d", evictedUrls: ["a"] });
  });

  it("starts the next download while the selected track is still loading", () => {
    const plan = planAudioPreload([source("a", "loading"), source("b", "idle"), source("c", "idle")], "a", [], 3, 1);
    expect(plan.loadUrl).toBe("b");
  });

  it("limits background downloads and does not keep downloading unrelated evicted tracks", () => {
    expect(
      planAudioPreload([source("a", "loaded"), source("b", "loading"), source("c", "idle")], "a", ["a"], 3, 1).loadUrl
    ).toBeUndefined();
    expect(
      planAudioPreload(
        [source("a", "idle"), source("b", "loaded"), source("c", "loaded"), source("d", "loaded")],
        "b",
        ["d", "c", "b"],
        3,
        1
      ).loadUrl
    ).toBeUndefined();
  });

  it("preloads the first track before continuing from the end of the playlist", () => {
    expect(getPlaybackWindow(["a", "b", "c", "d"], "d", 3)).toEqual(["d", "a", "b"]);
    expect(
      planAudioPreload(
        [source("a", "idle"), source("b", "idle"), source("c", "idle"), source("d", "loaded")],
        "d",
        ["d"],
        3,
        1
      ).loadUrl
    ).toBe("a");
  });

  it("keeps the playing track and its preloaded successors when a late old download finishes", () => {
    expect(trimAudioCache(["old", "next2", "next", "playing"], ["playing", "next", "next2"], 3)).toEqual({
      queue: ["next2", "next", "playing"],
      evictedUrls: ["old"],
    });
  });

  it("frees enough slots after manually selecting a track outside a full cache", () => {
    const plan = planAudioPreload(
      [
        source("a", "loaded"),
        source("b", "loaded"),
        source("c", "loaded"),
        source("d", "loading"),
        source("e", "idle"),
        source("f", "idle"),
      ],
      "d",
      ["c", "b", "a"],
      3,
      1
    );
    expect(plan).toEqual({ loadUrl: "e", evictedUrls: ["a", "b"] });
  });

  it("preserves the ended track identity in automatic PLAY requests", () => {
    expect(
      PlayActionSchema.parse({ type: "PLAY", audioSource: "b", previousAudioSource: "a", trackTimeSeconds: 0 })
        .previousAudioSource
    ).toBe("a");
  });

  it("preloads and protects the planned shuffle successor instead of the sequential track", () => {
    const sources = [
      source("a", "loaded"),
      source("b", "loaded"),
      source("c", "loaded"),
      source("d", "idle"),
      source("e", "idle"),
    ];
    expect(
      getPlaybackWindow(
        sources.map((item) => item.source.url),
        "b",
        3,
        "e"
      )
    ).toEqual(["b", "e", "a"]);
    expect(planAudioPreload(sources, "b", ["b", "c", "a"], 3, 1, "e")).toEqual({ loadUrl: "e", evictedUrls: ["c"] });
    expect(trimAudioCache(["c", "e", "b", "a"], ["b", "e", "a"], 3).evictedUrls).toEqual(["c"]);
  });
});
