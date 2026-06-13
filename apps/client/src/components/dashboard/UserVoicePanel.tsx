"use client";

import { useClientId } from "@/hooks/useClientId";
import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { useWebRTCStore } from "@/store/webrtc";
import { Headphones, Mic, MicOff, PhoneOff } from "lucide-react";
import React from "react";
import { Button } from "../ui/button";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { useAudioVolume } from "@/hooks/useAudioVolume";
import { AudioWaveform } from "../ui/AudioWaveform";
import { useVoiceChat } from "../room/VoiceChatProvider";

export const UserVoicePanel = () => {
  const { clientId } = useClientId();
  const connectedClients = useGlobalStore((state) => state.connectedClients);

  const {
    isConnected: isVoiceActive,
    isMuted,
    toggleMute,
    localStream,
    activeSpeakers,
    connect,
    disconnect,
  } = useVoiceChat();
  const isDeafened = useWebRTCStore((state) => state.isDeafened);
  const toggleDeafen = useWebRTCStore((state) => state.toggleDeafen);

  const localVolume = useAudioVolume(localStream);
  const isHearingRemote = activeSpeakers.size > 0 && !activeSpeakers.has("local");

  // Current client
  const currentUser = connectedClients.find((c) => c.clientId === clientId);
  const username = currentUser?.username || "You";

  // Generate avatar fallback
  const initials = username.slice(0, 2).toUpperCase();

  return (
    <div className="bg-[#292b2f] flex flex-col w-full h-[52px] mt-auto">
      <div className="flex items-center h-full px-2 gap-1.5 w-full">
        {/* User Info */}
        <div className="flex items-center gap-2 flex-1 min-w-0 hover:bg-white/5 rounded-md p-1 cursor-pointer transition-colors">
          <Avatar className="h-8 w-8 rounded-full border-none ring-0">
            <AvatarFallback className="bg-indigo-500 text-white text-xs font-medium">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-semibold text-white truncate leading-none mb-1">{username}</span>
            <span className="text-[10px] text-neutral-400 truncate leading-none flex items-center gap-1">
              {isVoiceActive ? (
                <span className="text-emerald-400 flex items-center gap-1.5 h-3">
                  <AudioWaveform volume={localVolume} className="mb-[1px]" />
                  Voice Connected
                </span>
              ) : (
                "Voice Disconnected"
              )}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center flex-shrink-0">
          {!isVoiceActive ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md hover:bg-white/10 transition-colors group"
              onClick={connect}
              title="Join Voice Chat"
            >
              <img
                src="/account.png"
                alt="Join"
                className="w-5 h-5 object-contain opacity-80 group-hover:opacity-100 transition-opacity invert"
              />
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8 rounded-md hover:bg-white/10 text-neutral-400 hover:text-neutral-200 transition-colors",
                  isMuted && "text-red-400 hover:text-red-300"
                )}
                onClick={toggleMute}
                title={isMuted ? "Unmute Mic" : "Mute Mic"}
              >
                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8 rounded-md hover:bg-white/10 transition-colors flex items-center justify-center",
                  isDeafened
                    ? "text-red-400 hover:text-red-300"
                    : isHearingRemote
                      ? "text-emerald-400 animate-pulse"
                      : "text-neutral-400 hover:text-neutral-200"
                )}
                onClick={toggleDeafen}
                title={isDeafened ? "Undeafen" : "Deafen"}
              >
                <div className={cn("transition-transform duration-200", isHearingRemote && !isDeafened && "scale-110")}>
                  {isDeafened ? (
                    <div className="relative">
                      <Headphones className="h-4 w-4" />
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-0.5 bg-current rotate-45" />
                    </div>
                  ) : (
                    <Headphones className="h-4 w-4" />
                  )}
                </div>
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-md hover:bg-white/10 text-neutral-400 hover:text-red-400 transition-colors"
                onClick={disconnect}
                title="Disconnect Voice"
              >
                <PhoneOff className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
