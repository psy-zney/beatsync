type PreloadSource = {
  source: { url: string };
  status: "idle" | "loading" | "loaded" | "error";
};

/** Follow playback order, including wrapping from the last track to the first. */
export function getPlaybackWindow(urls: string[], selectedUrl: string, limit: number, nextUrl?: string): string[] {
  if (!urls.length) return [];
  const start = Math.max(0, urls.indexOf(selectedUrl));
  const plannedNext = nextUrl ? urls.indexOf(nextUrl) : -1;
  const next = plannedNext >= 0 && plannedNext !== start ? plannedNext : (start + 1) % urls.length;
  const upcoming = Array.from({ length: urls.length }, (_, offset) => urls[(next + offset) % urls.length]);
  return [...new Set([urls[start], ...upcoming])].slice(0, limit);
}

/** Keep the selected and upcoming tracks ahead of older decoded buffers. */
export function trimAudioCache(queue: string[], protectedUrls: string[], limit: number) {
  const retained = [...new Set(queue)];
  const evictedUrls: string[] = [];
  while (retained.length > limit) {
    let victim = retained.length - 1;
    while (victim >= 0 && protectedUrls.includes(retained[victim])) victim--;
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
  maxBackgroundLoads: number,
  nextUrl?: string,
  isPlaying?: boolean
): { loadUrl?: string; evictedUrls: string[] } {
  if (!sources.length) return { evictedUrls: [] };

  const byUrl = new Map(sources.map((item) => [item.source.url, item]));

  // If a track is selected to be played:
  if (selectedUrl) {
    const selected = byUrl.get(selectedUrl);
    // 1. The selected track has absolute priority.
    // If the selected track is not yet loaded, secondary preloads must NEVER run concurrently.
    if (selected && selected.status !== "loaded") {
      if (selected.status === "idle") {
        return { loadUrl: selectedUrl, evictedUrls: [] };
      }
      return { evictedUrls: [] };
    }

    // 2. Secondary loading tracks must only load after the playing track has loaded AND started playing.
    if (isPlaying === false) {
      return { evictedUrls: [] };
    }
  }

  // Any ongoing load occupies the slot.
  const activeLoads = sources.filter((item) => item.status === "loading");
  if (activeLoads.length >= maxBackgroundLoads) return { evictedUrls: [] };

  const window = getPlaybackWindow(
    sources.map((item) => item.source.url),
    selectedUrl,
    maxBuffers,
    nextUrl
  );

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
