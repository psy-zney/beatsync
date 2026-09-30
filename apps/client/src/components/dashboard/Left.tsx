"use client";

import { audioContextManager } from "@/lib/audioContextManager";
import { cn } from "@/lib/utils";
import { MAX_NTP_MEASUREMENTS, useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { ChevronDown, Hash, SlidersHorizontal } from "lucide-react";
import { motion } from "motion/react";
import { Separator } from "../ui/separator";
import { ConnectedUsersList } from "./ConnectedUsersList";
import { RoomQRCode } from "./CopyRoom";
import { GlobalVolumeControl } from "./GlobalVolumeControl";
import { MobileNudgeControl } from "./MobileNudgeControl";
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
      {/* Header section */}
      {/* <div className="px-3 py-2 flex items-center gap-2">
        <div className="bg-neutral-800 rounded-md p-1.5">
          <Music className="h-4 w-4 text-white" />
        </div>
        <h1 className="font-semibold text-white">Beatsync</h1>
      </div>


      <Separator className="bg-neutral-800/50" /> */}

      {/* Navigation menu */}
      <motion.div className="px-3.5 py-3 lg:py-2 lg:mt-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium">
            <Hash size={18} />
            <span>Room {roomId}</span>
          </div>

          {/* QR Code Dialog */}
          <RoomQRCode />
        </div>
      </motion.div>

      <Separator className="bg-neutral-800/50" />

      <div className="lg:hidden space-y-3 px-3 pt-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
          <GlobalVolumeControl isMobile />
        </div>
        <details className="group rounded-2xl border border-white/10 bg-white/[0.03]">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium text-neutral-200 [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal className="size-4 text-violet-300" /> Timing adjustments
            <ChevronDown className="ml-auto size-4 text-neutral-500 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-white/10">
            <MobileNudgeControl />
          </div>
        </details>
      </div>

      {/* Connected Users List */}
      <div className="mt-3 lg:mt-0">
        <ConnectedUsersList />
      </div>

      <details className="group mx-3 mb-3 rounded-xl border border-white/10 lg:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 text-xs text-neutral-500 [&::-webkit-details-marker]:hidden">
          Connection details <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 px-4 py-3 text-[11px] font-mono text-neutral-500">
          <span>Offset: {clockOffset.toFixed(1)}ms</span>
          <span>RTT: {roundTripEstimate.toFixed(1)}ms</span>
          <span>OL: {audioContextManager.getOutputLatencyMs().toFixed(0)}ms</span>
          <span>
            NTP: {syncMeasurementCount}/{MAX_NTP_MEASUREMENTS}
          </span>
        </div>
      </details>

      {/* Playback Permissions */}

      {/* <Separator className="bg-neutral-800/50" /> */}

      <motion.div className="mt-auto pb-4 pt-2 text-neutral-400 hidden lg:block">
        <UserVoicePanel />
      </motion.div>
    </motion.div>
  );
};
