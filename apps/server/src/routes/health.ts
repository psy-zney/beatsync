import { globalManager } from "@/managers";
import { memoryPressureManager } from "@/managers/MemoryPressureManager";
import { streamTaskQueue } from "@/managers/StreamTaskQueue";
import { jsonResponse } from "@/utils/responses";

const startedAt = Date.now();

export function handleHealth(): Response {
  const memory = memoryPressureManager.getStatus();
  return jsonResponse({
    status: memory.level === "normal" ? "ok" : "degraded",
    uptimeMs: Date.now() - startedAt,
    startedAt: new Date(startedAt).toISOString(),
    rooms: globalManager.getRoomCount(),
    memory,
    streamQueue: streamTaskQueue.getStats(),
  });
}
