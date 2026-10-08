import type { TrackLyricsType } from "@beatsync/shared";

export interface LrcLine {
  /** Timestamp in seconds */
  time: number;
  text: string;
  end?: number;
  words?: { startTime: number; endTime: number; text: string }[];
}

/** Parse standard LRC, including repeated timestamps, translations and offsets. */
export function parseLrc(raw: string): LrcLine[] {
  const lines: LrcLine[] = [];
  const offset = Number(raw.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0) / 1000;
  const timestamp = /^\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/;

  for (const line of raw.split("\n")) {
    let remaining = line.trim();
    const times: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = timestamp.exec(remaining))) {
      times.push(Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] ?? "0"}`) + offset);
      remaining = remaining.slice(match[0].length).trimStart();
    }
    const tags = [...remaining.matchAll(/<(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?>/g)];
    const text = remaining
      .replace(/<\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?>/g, "")
      .trim()
      .replaceAll("\\n", "\n");
    for (const time of times) {
      const words = tags.flatMap((tag, index) => {
        const startTime = Number(tag[1]) * 60 + Number(tag[2]) + Number(`0.${tag[3] ?? "0"}`) + offset;
        const wordText = remaining.slice(tag.index! + tag[0].length, tags[index + 1]?.index).replaceAll("\\n", "\n");
        if (!wordText.trim() || startTime < time) return [];
        return [{ startTime, endTime: startTime, text: wordText }];
      });
      // Only retain real timing in chronological order, never synthesize words
      // from a plain sentence or repeated timestamp variants.
      const timed =
        times.length === 1 &&
        words.length > 0 &&
        words.every((word, index) => index === 0 || word.startTime >= words[index - 1].startTime);
      lines.push({ time, text, ...(timed ? { words } : {}) });
    }
  }

  const grouped: LrcLine[] = [];
  for (const line of lines.sort((a, b) => a.time - b.time)) {
    const previous = grouped.at(-1);
    if (previous?.time === line.time) {
      if (line.text && !previous.text.split("\n").includes(line.text)) {
        previous.text = [previous.text, line.text].filter(Boolean).join("\n");
        delete previous.words;
      }
    } else {
      grouped.push({ ...line });
    }
  }
  grouped.forEach((line, index) => {
    line.words?.forEach((word, wordIndex, words) => {
      word.endTime =
        words[wordIndex + 1]?.startTime ?? grouped[index + 1]?.time ?? Math.max(word.startTime + 1, line.time + 5);
    });
  });
  return grouped;
}

export function getLyricsLines(lyrics?: TrackLyricsType): LrcLine[] {
  if (lyrics?.lines?.length)
    return lyrics.lines.map((line) => ({
      time: line.startTime,
      end: line.endTime,
      text: line.text,
      words: line.words,
    }));
  return parseLrc(lyrics?.synced ?? "");
}

/**
 * Find the index of the current lyric line for a given playback time.
 * Returns -1 if playback hasn't reached the first line yet.
 */
export function getCurrentLineIndex(data: { lines: LrcLine[]; timeSeconds: number }): number {
  const { lines, timeSeconds } = data;
  if (!Number.isFinite(timeSeconds)) return -1;
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].time <= timeSeconds) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (high >= 0 && lines[high].end !== undefined && timeSeconds >= lines[high].end!) return -1;
  return high;
}

/** Visible cue state used by the animation-frame lyric clock. */
export function getLyricFrameKey(lines: LrcLine[], time: number): string {
  const index = getCurrentLineIndex({ lines, timeSeconds: time });
  const words = lines[index]?.words;
  const started = words?.findLastIndex((word) => time >= word.startTime) ?? -1;
  const active = started >= 0 && time < words![started].endTime ? started : -1;
  return `${index}:${started}:${active}:${Math.floor(time)}`;
}
