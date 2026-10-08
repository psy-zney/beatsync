import { describe, expect, it } from "bun:test";
import { getCurrentLineIndex, getLyricFrameKey, parseLrc } from "../lrc";

describe("synchronized lyrics", () => {
  it("updates on sub-second word boundaries and cue ends without rerendering identical frames", () => {
    const lines = [
      {
        time: 1,
        end: 2,
        text: "Xin chào",
        words: [
          { startTime: 1, endTime: 1.2, text: "Xin " },
          { startTime: 1.25, endTime: 2, text: "chào" },
        ],
      },
    ];
    expect(getLyricFrameKey(lines, 1.01)).toBe(getLyricFrameKey(lines, 1.19));
    expect(getLyricFrameKey(lines, 1.2)).not.toBe(getLyricFrameKey(lines, 1.19));
    expect(getLyricFrameKey(lines, 1.25)).not.toBe(getLyricFrameKey(lines, 1.24));
    expect(getLyricFrameKey(lines, 2)).not.toBe(getLyricFrameKey(lines, 1.99));
    expect(getLyricFrameKey(lines, NaN)).not.toBe(getLyricFrameKey(lines, 0));
  });
  it("accepts common timestamp precision, repeated timestamps and CRLF files", () => {
    expect(parseLrc("\uFEFF[ar:Artist]\r\n[00:12]First\r\n[0:15.5][01:10.050]Repeated\r\n[00:14.25]Middle")).toEqual([
      { time: 12, text: "First" },
      { time: 14.25, text: "Middle" },
      { time: 15.5, text: "Repeated" },
      { time: 70.05, text: "Repeated" },
    ]);
  });

  it("applies signed global offsets and keeps blank instrumental cues", () => {
    expect(parseLrc("[00:00.00]Intro\n[00:05.00]\n[offset:-250]\n[00:08.000]Verse")).toEqual([
      { time: -0.25, text: "Intro" },
      { time: 4.75, text: "" },
      { time: 7.75, text: "Verse" },
    ]);
    expect(parseLrc("[offset:+500]\n[00:01]Line")[0].time).toBe(1.5);
  });

  it("groups translations and preserves real enhanced word timestamps", () => {
    expect(
      parseLrc("[00:10]Hello\n[00:10.00]Xin chào\n[00:10]Hello\n[00:20]<00:20.00>Next <00:21.5>word\\nSecond line")
    ).toEqual([
      { time: 10, text: "Hello\nXin chào" },
      {
        time: 20,
        text: "Next word\nSecond line",
        words: [
          { startTime: 20, endTime: 21.5, text: "Next " },
          { startTime: 21.5, endTime: 25, text: "word\nSecond line" },
        ],
      },
    ]);
    expect(parseLrc("[00:75]Bad\nplain text\n[ti:Title]")).toEqual([]);
  });

  it("clears ended structured cues during instrumentals and follows backward seeks", () => {
    const lines = [
      { time: 1, end: 2, text: "Xin chào" },
      { time: 4, end: 6, text: "Câu sau" },
    ];
    expect([0, 1, 2, 3, 4, 6, 1.5].map((timeSeconds) => getCurrentLineIndex({ lines, timeSeconds }))).toEqual([
      -1, 0, -1, -1, 1, -1, 0,
    ]);
  });

  it("finds exact cue boundaries and follows backward/forward seeks without accumulated state", () => {
    const lines = parseLrc("[00:05]First\n[00:10]\n[00:15]Second");
    expect([0, 5, 9.99, 10, 15, 6, 99].map((timeSeconds) => getCurrentLineIndex({ lines, timeSeconds }))).toEqual([
      -1, 0, 0, 1, 2, 0, 2,
    ]);
    expect(getCurrentLineIndex({ lines: [], timeSeconds: 10 })).toBe(-1);
    expect(getCurrentLineIndex({ lines, timeSeconds: NaN })).toBe(-1);
  });
});
