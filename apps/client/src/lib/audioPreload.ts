type PreloadSource = {
  source: { url: string };
  status: "idle" | "loading" | "loaded" | "error";
};

/** Follow playback order, including wrapping from the last track to the first. */
export function getPlaybackWindow(urls: string[], selectedUrl: string, limit: number): string[] {
  const start = Math.max(0, urls.indexOf(selectedUrl));
  return Array.from({ length: Math.min(limit, urls.length) }, (_, offset) => urls[(start + offset) % urls.length]);
}

/** Keep the selected and upcoming tracks ahead of older decoded buffers. */
export function trimAudioCache(queue: string[], protectedUrls: string[], limit: number) {
  const retained = [...new Set(queue)];
  const evictedUrls: string[] = [];
  while (retained.length > limit) {
    const victim = retained.findLastIndex((url) => !protectedUrls.includes(url));
    if (victim < 0) break;
    evictedUrls.push(...retained.splice(victim, 1));
  }
  return { queue: retained, evictedUrls };
}

export function planAudioPreload(
  sources: PreloadSource[],
  selectedUrl: string,
  accessQueue: string[],
  maxBuffers: number,
  maxBackgroundLoads: number
): { loadUrl?: string; evictedUrls: string[] } {
  const window = getPlaybackWindow(
    sources.map((item) => item.source.url),
    selectedUrl,
    maxBuffers
  );
  const byUrl = new Map(sources.map((item) => [item.source.url, item]));
  // Loading the selected track must not prevent starting its successor early.
  const backgroundLoads = sources.filter((item) => item.status === "loading" && item.source.url !== selectedUrl);
  if (backgroundLoads.length >= maxBackgroundLoads) return { evictedUrls: [] };
  const loadUrl = window.find((url) => byUrl.get(url)?.status === "idle");
  if (!loadUrl) return { evictedUrls: [] };
  const activeCount = sources.filter((item) => item.status === "loaded" || item.status === "loading").length;
  if (activeCount < maxBuffers) return { loadUrl, evictedUrls: [] };

  // Free capacity even when the cache is full of tracks earlier in the playlist.
  const candidates = [...new Set([...accessQueue, ...sources.map((item) => item.source.url)])].reverse();
  const neededSlots = activeCount - maxBuffers + 1;
  const evictedUrls = candidates
    .filter((url) => !window.includes(url) && byUrl.get(url)?.status === "loaded")
    .slice(0, neededSlots);
  return evictedUrls.length === neededSlots ? { loadUrl, evictedUrls } : { evictedUrls: [] };
}
