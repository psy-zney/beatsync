"use client";

import { audioContextManager } from "@/lib/audioContextManager";
import { cn } from "@/lib/utils";
import { MAX_NTP_MEASUREMENTS, useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { Activity, ChevronDown, Hash, Settings2, SlidersHorizontal } from "lucide-react";
import { motion } from "motion/react";
import { Separator } from "../ui/separator";
import { AudioDeviceSelector } from "./AudioDeviceSelector";
import { ConnectedUsersList } from "./ConnectedUsersList";
import { RoomQRCode } from "./CopyRoom";
import { GlobalVolumeControl } from "./GlobalVolumeControl";
import { MobileNudgeControl } from "./MobileNudgeControl";
import { PlaybackPermissions } from "./PlaybackPermissions";
import { UserVoicePanel } from "./UserVoicePanel";

interface LeftProps {
  className?: string;
}

export const Left = ({ className }: LeftProps) => {
  const roomId = useRoomStore((state) => state.roomId);
  const clockOffset = useGlobalStore((state) => state.offsetEstimate);
  const roundTripEstimate = useGlobalStore((state) => state.roundTripEstimate);
  const syncMeasurementCount = useGlobalStore((state) => state.syncMeasurements.length);

  return (
    <motion.div
      className={cn(
        "w-full lg:w-80 lg:flex-shrink-0 lg:border-l border-neutral-800/50 bg-neutral-950 lg:bg-neutral-900/50 lg:backdrop-blur-md flex flex-col pb-3 lg:pb-0 text-sm overflow-y-auto flex-shrink-0 scrollbar-thin scrollbar-thumb-rounded-md scrollbar-thumb-muted-foreground/10 scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground/20",
        className
      )}
    >

      {/* Navigation menu */}
      <motion.div className="px-3.5 py-3 lg:py-2.5 lg:mt-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium text-neutral-200">
            <Hash size={18} className="text-neutral-400" />
            <span>Room {roomId}</span>
          </div>

          {/* QR Code Dialog */}
          <RoomQRCode />
        </div>
      </motion.div>

      <Separator className="bg-neutral-800/50" />

      {/* --- MOBILE CONTENT (< lg) --- */}
      <div className="lg:hidden space-y-3 px-3 pt-3 pb-2">
        {/* 1. Sound Controls Card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
          <GlobalVolumeControl isMobile />
        </div>

        {/* 2. Audio Devices Card */}
        <details className="group rounded-2xl border border-white/10 bg-white/[0.03] transition-colors">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-4 text-sm font-medium text-neutral-200 [&::-webkit-details-marker]:hidden">
            <Settings2 className="size-4 text-neutral-400" />
            <span>Audio Devices</span>
            <ChevronDown className="ml-auto size-4 text-neutral-400 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="border-t border-white/10 px-4 py-3">
            <AudioDeviceSelector />
          </div>
        </details>

        {/* 3. Timing Adjustments Card */}
        <details className="group rounded-2xl border border-white/10 bg-white/[0.03] transition-colors">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-4 text-sm font-medium text-neutral-200 [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal className="size-4 text-neutral-400" />
            <span>Timing Adjustments</span>
            <ChevronDown className="ml-auto size-4 text-neutral-400 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="border-t border-white/10 px-4 py-3">
            <MobileNudgeControl />
          </div>
        </details>

        {/* 4. Playback Permissions Card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <PlaybackPermissions />
        </div>

        {/* 5. Connected Users Card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <ConnectedUsersList />
        </div>

        {/* 7. Connection Diagnostics Card */}
        <details className="group rounded-2xl border border-white/10 bg-white/[0.03] transition-colors">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-4 text-xs font-medium text-neutral-400 [&::-webkit-details-marker]:hidden">
            <Activity className="size-3.5 text-neutral-500" />
            <span>Connection Diagnostics</span>
            <ChevronDown className="ml-auto size-4 text-neutral-500 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="border-t border-white/10 p-3">
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="rounded-lg bg-black/20 p-2.5 border border-white/5">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">Offset</div>
                <div className="text-neutral-200 font-semibold mt-0.5">{clockOffset.toFixed(1)} ms</div>
              </div>
              <div className="rounded-lg bg-black/20 p-2.5 border border-white/5">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">Round Trip (RTT)</div>
                <div className="text-neutral-200 font-semibold mt-0.5">{roundTripEstimate.toFixed(1)} ms</div>
              </div>
              <div className="rounded-lg bg-black/20 p-2.5 border border-white/5">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">Output Latency</div>
                <div className="text-neutral-200 font-semibold mt-0.5">
                  {audioContextManager.getOutputLatencyMs().toFixed(0)} ms
                </div>
              </div>
              <div className="rounded-lg bg-black/20 p-2.5 border border-white/5">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">NTP Quality</div>
                <div className="text-neutral-200 font-semibold mt-0.5">
                  {syncMeasurementCount} / {MAX_NTP_MEASUREMENTS}
                </div>
              </div>
            </div>
          </div>
        </details>
      </div>

      {/* --- DESKTOP CONTENT (lg:flex) --- */}
      <div className="hidden lg:flex lg:flex-col lg:flex-1 min-h-0">
        <PlaybackPermissions />
        <Separator className="bg-neutral-800/50" />
        <div className="flex-1 overflow-y-auto">
          <ConnectedUsersList />
        </div>
      </div>

      <motion.div className="mt-auto text-neutral-400 hidden lg:block border-t border-neutral-800/50">
        <UserVoicePanel />
      </motion.div>
    </motion.div>
  );
};
