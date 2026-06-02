"use client";

import { formatBytes, formatEta } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { Loader2 } from "lucide-react";

export const LoadingEtaOverlay = () => {
  const loadingSources = useGlobalStore((state) =>
    state.audioSources
      .filter((source) => source.status === "loading")
      .slice(0, 3)
      .map((source) => ({
        url: source.source.url,
        title: source.source.title ?? "Loading track",
        loadedBytes: source.loadedBytes ?? 0,
        totalBytes: source.totalBytes,
        transferRateBytesPerSecond: source.transferRateBytesPerSecond,
        estimatedRemainingMs: source.estimatedRemainingMs,
      }))
  );

  if (loadingSources.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-16 z-50">
      <div className="min-w-52 max-w-72 rounded-xl border border-white/10 bg-black/65 px-3 py-2 shadow-2xl backdrop-blur-md">
        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-neutral-400">
          <Loader2 className="size-3 animate-spin" />
          Loading Audio
        </div>
        <div className="space-y-2">
          {loadingSources.map((source) => {
            const progress =
              source.totalBytes && source.totalBytes > 0
                ? Math.min(100, Math.round((100 * source.loadedBytes) / source.totalBytes))
                : null;

            return (
              <div key={source.url} className="text-xs text-neutral-200">
                <div className="truncate font-medium">{source.title}</div>
                <div className="mt-0.5 text-[11px] text-neutral-400">
                  {progress !== null ? `${progress}%` : "Loading"}
                  {source.estimatedRemainingMs ? ` • ${formatEta(source.estimatedRemainingMs / 1000)} left` : ""}
                  {source.transferRateBytesPerSecond ? ` • ${formatBytes(source.transferRateBytesPerSecond)}/s` : ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
