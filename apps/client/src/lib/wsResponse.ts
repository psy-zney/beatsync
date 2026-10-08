import { WSResponseSchema, type WSResponseType } from "@beatsync/shared";

/** Decode each packet independently so an invalid packet cannot interrupt the room. */
export function decodeWSResponse(data: unknown): WSResponseType | null {
  if (typeof data !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    console.warn("Ignoring a WebSocket packet with invalid JSON");
    return null;
  }
  const result = WSResponseSchema.safeParse(value);
  if (result.success) return result.data;
  // Do not log packet contents: they can contain private messages or room data.
  const type = value && typeof value === "object" && "type" in value ? value.type : undefined;
  console.warn("Ignoring an invalid WebSocket response", {
    type: typeof type === "string" ? type.slice(0, 64) : "missing",
  });
  return null;
}
