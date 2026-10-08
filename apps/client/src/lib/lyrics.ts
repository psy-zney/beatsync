import { TrackLyricsSchema, type TrackLyricsType } from "@beatsync/shared";
import { z } from "zod";
import { parseLrc } from "./lrc";

const LyricsRecordSchema = z.object({
  id: z.number().int(),
  trackName: z.string(),
  artistName: z.string(),
  albumName: z.string(),
  duration: z.number().finite(),
  instrumental: z.boolean(),
  plainLyrics: z.string().nullable(),
  syncedLyrics: z.string().nullable(),
});
export type LyricsRecord = z.infer<typeof LyricsRecordSchema>;

export function buildLyricsQuery(title: string): string {
  return title
    .replace(/\.(mp3|m4a|wav|flac|ogg|aac|webm)$/i, "")
    .replace(/[\[(](?:official\s*)?(?:music\s*video|audio|video|lyrics?|lyric\s*video|visuali[sz]er)[^\])]*[\])]/gi, "")
    .replace(/\s*[|–—]\s*(?:official\s*)?(?:music\s*video|audio|video|lyrics?).*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Auto-select only a complete title/artist match with a matching duration. */
export function findAutomaticLyrics(
  records: LyricsRecord[],
  title: string,
  duration: number
): LyricsRecord | undefined {
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  const query = normalize(buildLyricsQuery(title));
  return records
    .filter((record) => {
      const track = normalize(record.trackName);
      const artist = normalize(record.artistName);
      return (
        track &&
        artist &&
        (query === `${artist} ${track}` || query === `${track} ${artist}`) &&
        Math.abs(record.duration - duration) <= 3 &&
        !!record.syncedLyrics &&
        parseLrc(record.syncedLyrics).some((line) => line.text)
      );
    })
    .sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration))[0];
}

export function lyricsFromRecord(record: LyricsRecord): TrackLyricsType {
  const synced =
    record.syncedLyrics && parseLrc(record.syncedLyrics).some((line) => line.text) ? record.syncedLyrics : "";
  if (!synced && !record.plainLyrics?.trim()) throw new Error("This record has no usable lyrics.");
  // Avoid sending two copies of the same lyrics through the room WebSocket.
  return TrackLyricsSchema.parse({
    synced,
    plain: synced ? "" : (record.plainLyrics ?? ""),
    offset: 0,
    provider: "lrclib",
    syncType: synced ? (parseLrc(synced).some((line) => line.words?.length) ? "word" : "line") : "none",
  });
}

export function lyricsFromText(raw: string): TrackLyricsType {
  const text = raw.trim();
  if (!text) throw new Error("Paste lyrics or choose an .lrc file first.");
  const lines = parseLrc(text);
  if (/\[\d+:/.test(text) && !lines.some((line) => line.text)) {
    throw new Error("No valid lyric lines. Use timestamps such as [00:12.50]Your lyric.");
  }
  return TrackLyricsSchema.parse({
    synced: lines.length ? text : "",
    plain: lines.length ? "" : text,
    offset: 0,
    provider: "import",
    syncType: lines.length ? (lines.some((line) => line.words?.length) ? "word" : "line") : "none",
  });
}

/** LRCLIB's public, CORS-enabled API; requests stop when the dialog closes. */
export async function searchLyrics(query: string, signal: AbortSignal): Promise<LyricsRecord[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 10_000);
  try {
    const response = await fetch(`https://lrclib.net/api/search?${new URLSearchParams({ q: query })}`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Lyrics search is unavailable. Try again or import an .lrc file.");
    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) throw new Error("Invalid response from lyrics search.");
    return raw
      .flatMap((item) => {
        const record = LyricsRecordSchema.safeParse(item);
        if (!record.success || record.data.instrumental || (!record.data.syncedLyrics && !record.data.plainLyrics))
          return [];
        return [record.data];
      })
      .slice(0, 20);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
