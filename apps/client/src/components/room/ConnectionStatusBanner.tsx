"use client";

import { useGlobalStore } from "@/store/global";
import { Loader2, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

export const ConnectionStatusBanner = () => {
  const reconnectionInfo = useGlobalStore((state) => state.reconnectionInfo);
  const hasUserStartedSystem = useGlobalStore((state) => state.hasUserStartedSystem);
  const selectedAudioUrl = useGlobalStore((state) => state.selectedAudioUrl);
  const selectedSourceStatus = useGlobalStore(
    (state) => state.audioSources.find((source) => source.source.url === selectedAudioUrl)?.status
  );

  const isVisible = hasUserStartedSystem && reconnectionInfo.isReconnecting;
  const isWaitingForAudio = selectedSourceStatus === "loading" || selectedSourceStatus === "idle";

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="pointer-events-none fixed left-1/2 top-14 z-[60] w-[calc(100%-1rem)] max-w-xl -translate-x-1/2"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
        >
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/25 bg-neutral-950/90 px-3 py-2 text-amber-100 shadow-2xl backdrop-blur-xl">
            <WifiOff className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs font-semibold">
                Mất kết nối tạm thời
                <Loader2 className="size-3 animate-spin text-amber-400" />
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-300">
                Đang tự kết nối lại (lần {reconnectionInfo.currentAttempt}). Giao diện và nhạc đã lưu trong RAM vẫn được
                giữ nguyên.
                {isWaitingForAudio && " Bài chưa tải xong sẽ tiếp tục loading khi có mạng."}
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
