"use client";

import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum, PlaybackControlsPermissionsEnum } from "@beatsync/shared";
import { Crown, Shield, Users } from "lucide-react";
import { motion } from "motion/react";

export const PlaybackPermissions = () => {
  const currentUser = useGlobalStore((state) => state.currentUser);
  const socket = useGlobalStore((state) => state.socket);
  const playbackControlsPermissions = useGlobalStore((state) => state.playbackControlsPermissions);

  if (!socket) {
    return null;
  }

  const isAdmin = currentUser?.isAdmin || currentUser?.isCreator || false;
  const isAdminOnly = playbackControlsPermissions === PlaybackControlsPermissionsEnum.enum.ADMIN_ONLY;

  const handleToggle = () => {
    if (!isAdmin) return;
    const newPermission = isAdminOnly
      ? PlaybackControlsPermissionsEnum.enum.EVERYONE
      : PlaybackControlsPermissionsEnum.enum.ADMIN_ONLY;

    sendWSRequest({
      ws: socket,
      request: {
        type: ClientActionEnum.enum.SET_PLAYBACK_CONTROLS,
        permissions: newPermission,
      },
    });
  };

  return (
    <div className="py-1">
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <h2 className="text-xs font-semibold tracking-wider text-neutral-400 flex items-center gap-1.5 uppercase">
          <Shield className="h-3.5 w-3.5 text-yellow-500/80" />
          <span>Quyền điều khiển</span>
        </h2>
        {!isAdmin && <span className="text-[10px] text-neutral-500 font-medium">Chỉ chủ phòng chỉnh</span>}
      </div>

      <div className="px-4 pb-3">
        {/* Toggle Container */}
        <button
          type="button"
          onClick={isAdmin ? handleToggle : undefined}
          disabled={!isAdmin}
          aria-label="Toggle playback permissions"
          className={cn(
            "relative flex w-full h-8 bg-neutral-900 border border-white/5 rounded-lg p-0.5 mt-1.5 focus:outline-none transition-opacity",
            isAdmin ? "cursor-pointer hover:border-white/10" : "opacity-80 cursor-default"
          )}
        >
          {/* Sliding Background */}
          <motion.div
            className={cn(
              "absolute inset-y-0.5 w-[calc(50%-2px)] transition-colors duration-300 rounded-md shadow-xs",
              isAdminOnly
                ? "bg-gradient-to-r from-amber-600 to-yellow-600"
                : "bg-gradient-to-r from-emerald-600 to-green-600"
            )}
            initial={false}
            animate={{
              x: isAdminOnly ? "calc(100% - 2px)" : 2,
            }}
            transition={{
              type: "spring",
              stiffness: 700,
              damping: 40,
            }}
          />

          {/* Everyone Option */}
          <div
            className={cn(
              "relative z-10 flex-1 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors duration-200 h-full select-none",
              !isAdminOnly ? "text-white" : "text-neutral-400"
            )}
          >
            <Users className="h-3.5 w-3.5" />
            <span>Mọi người</span>
          </div>

          {/* Admin Only Option */}
          <div
            className={cn(
              "relative z-10 flex-1 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors duration-200 h-full select-none",
              isAdminOnly ? "text-white" : "text-neutral-400"
            )}
          >
            <Crown className="h-3.5 w-3.5" />
            <span>Chủ phòng</span>
          </div>
        </button>
      </div>
    </div>
  );
};
