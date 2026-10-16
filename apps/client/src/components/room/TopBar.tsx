"use client";
import { SOCIAL_LINKS } from "@/constants";
import { audioContextManager } from "@/lib/audioContextManager";
import { MAX_NTP_MEASUREMENTS, useGlobalStore } from "@/store/global";
import { formatBytes, formatEta } from "@/lib/utils";
import { Crown, Hash, Loader2, Users, Volume2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { FaDiscord, FaGithub } from "react-icons/fa";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum } from "@beatsync/shared";
import { SyncProgress } from "../ui/SyncProgress";

interface TopBarProps {
  roomId: string;
}

export const TopBar = ({ roomId }: TopBarProps) => {
  const isLoadingAudio = useGlobalStore((state) => state.isInitingSystem);
  const isSynced = useGlobalStore((state) => state.isSynced);
  const hasUserStartedSystem = useGlobalStore((state) => state.hasUserStartedSystem);
  const roundTripEstimate = useGlobalStore((state) => state.roundTripEstimate);
  const connectedClientCount = useGlobalStore((state) => state.connectedClients.length);
  const clockOffset = useGlobalStore((state) => state.offsetEstimate);
  const syncMeasurementCount = useGlobalStore((state) => state.syncMeasurements.length);
  const isAudioContextSuspended = useGlobalStore((state) => state.isAudioContextSuspended);
  const isPlaying = useGlobalStore((state) => state.isPlaying);

  const audioSources = useGlobalStore((state) => state.audioSources);
  const selectedAudioUrl = useGlobalStore((state) => state.selectedAudioUrl);
  const isWaitingForRoom = useGlobalStore((state) => state.isWaitingForRoom);

  // Get current user from global store
  const currentUser = useGlobalStore((state) => state.currentUser);
  const isAdmin = currentUser?.isAdmin || currentUser?.isCreator || false;

  const loadingSource =
    audioSources.find((source) => source.status === "loading" && source.source.url === selectedAudioUrl) ||
    audioSources.find((source) => source.status === "loading");

  const selectedSource = audioSources.find((source) => source.source.url === selectedAudioUrl);

  const loadingInfo = (() => {
    if (loadingSource && loadingSource.status === "loading") {
      const progress =
        loadingSource.totalBytes && loadingSource.totalBytes > 0
          ? Math.min(100, Math.round((100 * (loadingSource.loadedBytes ?? 0)) / loadingSource.totalBytes))
          : null;
      const rate = loadingSource.transferRateBytesPerSecond
        ? `${formatBytes(loadingSource.transferRateBytesPerSecond)}/s`
        : null;
      const eta = loadingSource.estimatedRemainingMs
        ? `${formatEta(loadingSource.estimatedRemainingMs / 1000)} left`
        : null;

      return {
        type: "downloading" as const,
        title: loadingSource.source.title ?? "Loading track",
        progress,
        rate,
        eta,
      };
    }

    if (isWaitingForRoom && selectedSource?.status === "loaded") {
      return {
        type: "waiting_for_room" as const,
        title: selectedSource.source.title ?? "Track loaded",
      };
    }

    return null;
  })();

  // Show minimal nav bar when synced and not loading
  if (!isLoadingAudio && (isSynced || hasUserStartedSystem)) {
    return (
      <div className="h-8 bg-black/80 backdrop-blur-md z-50 flex items-center justify-between px-4 border-b border-zinc-800">
        <div className="flex items-center space-x-4 text-xs text-neutral-400 py-2 md:py-0 min-w-0 overflow-hidden">
          {isAdmin && (
            <div className="flex items-center shrink-0" title="Admin">
              <Crown className="h-3.5 w-3.5 text-yellow-500" fill="currentColor" />
            </div>
          )}
          <Link href="/" className="font-medium hover:text-white transition-colors shrink-0">
            Beatsync
          </Link>

          {/* NTP Measurements Indicator */}
          <div className="items-center hidden md:flex shrink-0">
            <motion.svg width="14" height="14" viewBox="0 0 14 14" className="mr-1">
              <circle
                cx="7"
                cy="7"
                r="5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-neutral-600"
              />
              <motion.circle
                cx="7"
                cy="7"
                r="5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-green-500"
                strokeDasharray={`${(syncMeasurementCount / MAX_NTP_MEASUREMENTS) * 31.4} 31.4`}
                strokeLinecap="round"
                transform="rotate(-90 7 7)"
                initial={{ strokeDasharray: "0 31.4" }}
                animate={{
                  strokeDasharray: `${(syncMeasurementCount / MAX_NTP_MEASUREMENTS) * 31.4} 31.4`,
                }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
              />
            </motion.svg>
            <span className="text-xs">
              {syncMeasurementCount}/{MAX_NTP_MEASUREMENTS}
            </span>
          </div>
          <div className="flex items-center shrink-0">
            <Hash size={12} className="mr-1" />
            <span className="flex items-center">{roomId}</span>
          </div>
          <div className="flex items-center shrink-0">
            <Users size={12} className="mr-1" />
            <span className="flex items-center">
              <span className="mr-1.5">
                {connectedClientCount} {connectedClientCount === 1 ? "user" : "users"}
              </span>
            </span>
          </div>
          {/* Hide separator on small screens */}
          <div className="hidden md:block shrink-0">|</div>
          {/* Hide Offset/RTT on small screens */}
          <div className="hidden md:flex items-center space-x-2 shrink-0">
            <span>Offset: {clockOffset.toFixed(2)}ms</span>
            <span>RTT: {roundTripEstimate.toFixed(2)}ms</span>
            <span>OL: {audioContextManager.getOutputLatencyMs().toFixed(0)}ms</span>
          </div>
        </div>

        {/* Right side: Audio loading notification + Social links */}
        <div className="flex items-center gap-3 shrink-0">
          <AnimatePresence>
            {isAudioContextSuspended && !isPlaying && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
                onClick={async () => {
                  await audioContextManager.unlockAudio();
                  useGlobalStore.setState({ isAudioContextSuspended: false });
                  const globalState = useGlobalStore.getState();
                  if (globalState.selectedAudioUrl && !globalState.isPlaying) {
                    const socket = globalState.socket;
                    if (socket?.readyState === WebSocket.OPEN) {
                      sendWSRequest({
                        ws: socket,
                        request: { type: ClientActionEnum.enum.SYNC },
                      });
                    }
                  }
                }}
                className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-medium transition-colors shadow-sm animate-pulse cursor-pointer shrink-0"
                title="Browser blocked audio. Click to enable sound and sync playback."
              >
                <Volume2 className="size-3.5 text-amber-400" />
                <span>Click to unmute</span>
              </motion.button>
            )}
            {loadingInfo && (
              <motion.div
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-900/90 border border-zinc-700/60 text-zinc-300 text-xs shadow-sm max-w-[200px] sm:max-w-[320px] md:max-w-[420px]"
              >
                <Loader2 className="size-3 animate-spin text-emerald-400 shrink-0" />
                {loadingInfo.type === "downloading" ? (
                  <div className="flex items-center gap-1.5 truncate">
                    <span
                      className="font-medium text-white truncate max-w-[90px] sm:max-w-[140px] md:max-w-[190px]"
                      title={loadingInfo.title}
                    >
                      {loadingInfo.title}
                    </span>
                    <span className="text-emerald-400 font-mono text-[11px] shrink-0 font-medium">
                      {loadingInfo.progress !== null ? `${loadingInfo.progress}%` : "Loading..."}
                    </span>
                    {loadingInfo.rate && (
                      <span className="text-neutral-400 text-[10px] hidden sm:inline shrink-0">
                        • {loadingInfo.rate}
                      </span>
                    )}
                    {loadingInfo.eta && (
                      <span className="text-neutral-400 text-[10px] hidden md:inline shrink-0">
                        • {loadingInfo.eta}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="truncate text-yellow-300/90 font-medium text-[11px]">
                    Waiting for room to load track…
                  </span>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-center gap-2.5">
            {/* Discord icon */}
            <a
              href={SOCIAL_LINKS.discord}
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-400 hover:text-white transition-colors"
              title="Discord"
            >
              <FaDiscord className="size-[17px]" />
            </a>
            {/* GitHub icon in the top right */}
            <a
              href={SOCIAL_LINKS.github}
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-400 hover:text-white transition-colors"
              title="GitHub"
            >
              <FaGithub className="size-4" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Use the existing SyncProgress component for loading/syncing states
  return (
    <AnimatePresence>
      {isLoadingAudio && (
        <motion.div exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
          <SyncProgress />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
