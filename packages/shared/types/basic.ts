import { z } from "zod";
import { CHAT_CONSTANTS } from "../constants";

export const GRID = {
  SIZE: 100,
  ORIGIN_X: 50,
  ORIGIN_Y: 50,
  CLIENT_RADIUS: 25,
} as const;

export const PositionSchema = z.object({
  x: z.number().min(0).max(GRID.SIZE),
  y: z.number().min(0).max(GRID.SIZE),
});
export type PositionType = z.infer<typeof PositionSchema>;

export const AvatarSchema = z
  .string()
  .max(120_000)
  .refine(
    (value) => Array.from(value).length <= 8 || value.startsWith("data:image/jpeg;base64,"),
    "Avatar must be a short emoji or a processed JPEG"
  );

export const MAX_LYRICS_BYTES = 40_000;

const LyricWordSchema = z
  .object({
    startTime: z.number().finite().min(0).max(86400),
    endTime: z.number().finite().min(0).max(86400),
    text: z.string().max(MAX_LYRICS_BYTES),
  })
  .refine((word) => word.endTime >= word.startTime);

const LyricLineSchema = z
  .object({
    startTime: z.number().finite().min(0).max(86400),
    endTime: z.number().finite().min(0).max(86400),
    text: z.string().max(MAX_LYRICS_BYTES),
    words: z.array(LyricWordSchema).max(200).optional(),
  })
  .refine(
    (line) =>
      line.endTime >= line.startTime &&
      (line.words ?? []).every(
        (word, index, words) =>
          word.startTime >= line.startTime &&
          word.endTime <= line.endTime + 0.001 &&
          (index === 0 || word.startTime >= words[index - 1].startTime)
      )
  );

export const TrackLyricsSchema = z
  .object({
    synced: z.string().max(MAX_LYRICS_BYTES),
    plain: z.string().max(MAX_LYRICS_BYTES),
    offset: z.number().finite().min(-30).max(30),
    provider: z.enum(["lrclib", "import", "youtube-manual", "youtube-auto", "user", "custom"]),
    language: z.string().max(16).optional(),
    syncType: z.enum(["none", "line", "word"]).optional(),
    lines: z.array(LyricLineSchema).max(1500).optional(),
    resolverVersion: z.number().int().min(0).max(1000).optional(),
    automatic: z.boolean().optional(),
  })
  .refine((lyrics) => new TextEncoder().encode(lyrics.synced + lyrics.plain).byteLength <= MAX_LYRICS_BYTES)
  .refine(
    (lyrics) =>
      !lyrics.lines?.length ||
      (new TextEncoder().encode(JSON.stringify(lyrics)).byteLength <= MAX_LYRICS_BYTES &&
        lyrics.lines.every((line, index, lines) => index === 0 || line.startTime >= lines[index - 1].startTime))
  );
export type TrackLyricsType = z.infer<typeof TrackLyricsSchema>;

export const AudioSourceSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  lyrics: TrackLyricsSchema.optional(),
  lyricsState: z.enum(["fetching", "ready", "not_found", "error"]).optional(),
  lyricsVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
});
export type AudioSourceType = z.infer<typeof AudioSourceSchema>;

export const ChatMessageSchema = z.object({
  id: z.number(),
  clientId: z.string(),
  username: z.string(),
  text: z.string().max(CHAT_CONSTANTS.MAX_MESSAGE_LENGTH),
  timestamp: z.number(),
  countryCode: z.string().optional(),
  isCreator: z.boolean().default(false),
  replyTo: z
    .object({
      id: z.number(),
      username: z.string(),
      text: z.string(),
    })
    .optional(),
});
export type ChatMessageType = z.infer<typeof ChatMessageSchema>;
