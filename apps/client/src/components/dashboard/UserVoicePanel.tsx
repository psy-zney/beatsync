"use client";

import { useClientId } from "@/hooks/useClientId";
import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { useWebRTCStore } from "@/store/webrtc";
import { Headphones, Mic, MicOff, Phone, PhoneOff, Volume2 } from "lucide-react";
import React from "react";
import { Button } from "../ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { useAudioVolume } from "@/hooks/useAudioVolume";
import { AudioWaveform } from "../ui/AudioWaveform";
import { useVoiceChat } from "../room/VoiceChatProvider";
import { useRoomStore } from "@/store/room";

export const UserVoicePanel = ({ mobile = false }: { mobile?: boolean }) => {
  const { clientId } = useClientId();
  const connectedClients = useGlobalStore((state) => state.connectedClients);

  const {
    isConnected: isVoiceActive,
    isConnecting,
    isReconnecting,
    isMuted,
    needsAudioPlayback,
    enableAudioPlayback,
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
  const roomAvatar = useRoomStore((state) => state.avatar);
  const username = currentUser?.username || "You";

  const isDataAvatar = roomAvatar?.startsWith("data:");
  const isEmojiAvatar = roomAvatar && !isDataAvatar && roomAvatar.length <= 4;
  const initials = username.slice(0, 2).toUpperCase();

  if (mobile) {
    return (
      <div
        className="relative z-20 shrink-0 border-b border-white/10 bg-neutral-900/95 px-3 py-2"
        aria-label="Voice chat controls"
      >
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl",
              isVoiceActive ? "bg-emerald-500/15 text-emerald-400" : "bg-violet-500/15 text-violet-300"
            )}
          >
            <Headphones className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-tight">Voice chat</div>
            <div className="text-xs text-neutral-400">
              {isReconnecting
                ? "Reconnecting…"
                : isConnecting
                  ? "Joining…"
                  : isVoiceActive
                    ? isMuted
                      ? "Connected · mic off"
                      : "Connected · mic on"
                    : "Ready to join"}
            </div>
          </div>
          {!isVoiceActive ? (
            <Button
              type="button"
              onClick={connect}
              disabled={isConnecting}
              className="h-11 min-w-24 rounded-xl bg-violet-600 px-3 text-white hover:bg-violet-500"
              aria-label="Join voice chat"
            >
              {isConnecting ? (
                <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <>
                  <Phone className="size-4" /> Join call
                </>
              )}
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={toggleMute}
                className={cn("size-11 rounded-xl", isMuted ? "text-red-400" : "text-emerald-400")}
                aria-label={isMuted ? "Turn microphone on" : "Turn microphone off"}
              >
                {isMuted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={toggleDeafen}
                className={cn("size-11 rounded-xl", isDeafened && "text-red-400")}
                aria-label={isDeafened ? "Turn call sound on" : "Turn call sound off"}
              >
                <Headphones className="size-5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={disconnect}
                className="size-11 rounded-xl text-neutral-400 hover:text-red-400"
                aria-label="Leave voice chat"
              >
                <PhoneOff className="size-5" />
              </Button>
            </div>
          )}
        </div>
        {isVoiceActive && needsAudioPlayback && (
          <button
            type="button"
            onClick={() => void enableAudioPlayback()}
            className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-amber-400/15 px-3 py-2 text-xs font-medium text-amber-200 ring-1 ring-amber-400/25"
          >
            <Volume2 className="size-4" /> Enable call sound
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-[#292b2f] flex flex-col w-full min-h-[52px] mt-auto">
      <div className="flex items-center h-full px-2 gap-1.5 w-full">
        {/* User Info */}
        <div className="flex items-center gap-2 flex-1 min-w-0 hover:bg-white/5 rounded-md p-1 cursor-pointer transition-colors">
          <Avatar className="h-8 w-8 rounded-full border-none ring-0">
            {isDataAvatar ? (
              <AvatarImage src={roomAvatar} className="object-cover" alt={username} />
            ) : isEmojiAvatar ? (
              <AvatarFallback className="bg-indigo-600 text-sm font-normal select-none">{roomAvatar}</AvatarFallback>
            ) : (
              <AvatarFallback className="bg-indigo-500 text-white text-xs font-medium">{initials}</AvatarFallback>
            )}
          </Avatar>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-semibold text-white truncate leading-none mb-1">{username}</span>
            <span className="text-[10px] text-neutral-400 truncate leading-none flex items-center gap-1">
              {isReconnecting ? (
                <span className="flex h-3 items-center gap-1.5 text-amber-400">
                  <span className="size-2 animate-pulse rounded-full bg-amber-400" />
                  Reconnecting Voice…
                </span>
              ) : isVoiceActive ? (
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
              disabled={isConnecting}
              title="Join Voice Chat (Spy icons created by Leremy - Flaticon)"
            >
              {isConnecting ? (
                <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <img
                  src="/account.png"
                  alt="Join"
                  className="w-5 h-5 object-contain opacity-80 group-hover:opacity-100 transition-opacity"
                />
              )}
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
      {isVoiceActive && needsAudioPlayback && (
        <button
          type="button"
          onClick={() => void enableAudioPlayback()}
          className="bg-amber-400/15 px-3 py-1.5 text-xs text-amber-200"
        >
          Enable call sound
        </button>
      )}
    </div>
  );
};
