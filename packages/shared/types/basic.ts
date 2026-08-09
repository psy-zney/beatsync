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

export const AudioSourceSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
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
