"use client";

import { useClientId } from "@/hooks/useClientId";
import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { useWebRTCStore } from "@/store/webrtc";
import { Headphones, Mic, MicOff, Music, Settings, Volume2, VolumeX } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Avatar, AvatarFallback } from "../ui/avatar";

// Component to render individual remote audio
const RemoteAudio = ({ clientId, stream }: { clientId: string; stream: MediaStream }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const micVolumes = useGlobalStore((state) => state.micVolumes);
  const isDeafened = useWebRTCStore((state) => state.isDeafened);

  useEffect(() => {
    if (audioRef.current && stream) {
      audioRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    if (audioRef.current) {
      if (isDeafened) {
        audioRef.current.volume = 0;
      } else {
        const volume = micVolumes[clientId] ?? 1.0;
        audioRef.current.volume = volume;
      }
    }
  }, [micVolumes, clientId, isDeafened]);

  return <audio ref={audioRef} autoPlay hidden />;
};

const VolumeControl = ({
  icon,
  label,
  value,
  onChange,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number; // 0 to 1
  onChange: (val: number) => void;
  disabled?: boolean;
}) => {
  const percent = Math.round(value * 100);
  const [inputValue, setInputValue] = useState(percent.toString());

  useEffect(() => {
    setInputValue(percent.toString());
  }, [percent]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleInputBlur = () => {
    let parsed = parseInt(inputValue, 10);
    if (isNaN(parsed)) parsed = percent;
    parsed = Math.max(0, Math.min(100, parsed));
    setInputValue(parsed.toString());
    onChange(parsed / 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleInputBlur();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      let parsed = parseInt(inputValue, 10) || 0;
      parsed = Math.min(100, parsed + 1);
      setInputValue(parsed.toString());
      onChange(parsed / 100);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      let parsed = parseInt(inputValue, 10) || 0;
      parsed = Math.max(0, parsed - 1);
      setInputValue(parsed.toString());
      onChange(parsed / 100);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-neutral-300">
          {icon}
          <span className="truncate max-w-[120px]" title={label}>{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <Input
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className="h-6 w-12 text-right px-1 py-0 text-xs bg-neutral-900 border-neutral-700 font-mono text-neutral-300"
            type="text"
          />
          <span className="text-xs text-neutral-500 font-mono">%</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Slider
          value={[percent]}
          min={0}
          max={100}
          step={1}
          onValueChange={(val) => onChange(val[0] / 100)}
          disabled={disabled}
          className={cn("flex-1", disabled && "opacity-50")}
        />
      </div>
    </div>
  );
};

export const UserVoicePanel = () => {
  const { clientId } = useClientId();
  const connectedClients = useGlobalStore((state) => state.connectedClients);

  const personalVolume = useGlobalStore((state) => state.personalVolume);
  const setPersonalVolume = useGlobalStore((state) => state.setPersonalVolume);
  const micVolumes = useGlobalStore((state) => state.micVolumes);
  const setMicVolume = useGlobalStore((state) => state.setMicVolume);

  const isVoiceActive = useWebRTCStore((state) => state.isVoiceActive);
  const toggleVoice = useWebRTCStore((state) => state.toggleVoice);
  const isDeafened = useWebRTCStore((state) => state.isDeafened);
  const toggleDeafen = useWebRTCStore((state) => state.toggleDeafen);
  const remoteStreams = useWebRTCStore((state) => state.remoteStreams);

  // Current client
  const currentUser = connectedClients.find((c) => c.clientId === clientId);
  const username = currentUser?.username || "You";

  // Other clients in room
  const otherClients = connectedClients.filter((c) => c.clientId !== clientId);

  const previousClientsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentClientIds = new Set(connectedClients.map((c) => c.clientId));
    const previousClientIds = previousClientsRef.current;

    previousClientIds.forEach((id) => {
      if (!currentClientIds.has(id)) {
        useWebRTCStore.getState().handleClientLeft(id);
      }
    });

    previousClientsRef.current = currentClientIds;
  }, [connectedClients]);

  // Generate avatar fallback
  const initials = username.slice(0, 2).toUpperCase();

  return (
    <div className="bg-[#292b2f] flex flex-col w-full h-[52px] mt-auto">
      <div className="flex items-center h-full px-2 gap-1.5 w-full">
        {/* User Info */}
        <div className="flex items-center gap-2 flex-1 min-w-0 hover:bg-white/5 rounded-md p-1 cursor-pointer transition-colors">
          <Avatar className="h-8 w-8 rounded-full border-none ring-0">
            <AvatarFallback className="bg-indigo-500 text-white text-xs font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-semibold text-white truncate leading-none mb-1">
              {username}
            </span>
            <span className="text-[10px] text-neutral-400 truncate leading-none flex items-center gap-1">
              {isVoiceActive ? (
                <span className="text-emerald-400 flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
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
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 rounded-md hover:bg-white/10 text-neutral-400 hover:text-neutral-200 transition-colors",
              !isVoiceActive && "text-red-400 hover:text-red-300"
            )}
            onClick={toggleVoice}
            title={isVoiceActive ? "Turn Off Mic" : "Turn On Mic"}
          >
            {isVoiceActive ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          </Button>
          
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 rounded-md hover:bg-white/10 text-neutral-400 hover:text-neutral-200 transition-colors",
              isDeafened && "text-red-400 hover:text-red-300"
            )}
            onClick={toggleDeafen}
            title={isDeafened ? "Undeafen" : "Deafen"}
          >
            {isDeafened ? (
              <div className="relative">
                <Headphones className="h-4 w-4" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-0.5 bg-current rotate-45" />
              </div>
            ) : (
              <Headphones className="h-4 w-4" />
            )}
          </Button>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-md hover:bg-white/10 text-neutral-400 hover:text-neutral-200 transition-colors"
                title="Voice & Audio Settings"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent 
              side="top" 
              align="end" 
              className="w-72 bg-[#2b2d31] border-neutral-800 p-0 shadow-xl overflow-hidden"
            >
              <div className="p-3 bg-black/20 border-b border-neutral-800/50">
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                  Voice & Audio Settings
                </h3>
              </div>
              
              <div className="p-3 space-y-4 max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-neutral-700 scrollbar-track-transparent">
                {/* Personal Music Volume */}
                <div className="bg-black/10 p-2.5 rounded-md border border-white/5">
                  <VolumeControl
                    icon={<Music className="h-3.5 w-3.5" />}
                    label="Your Music Volume"
                    value={personalVolume}
                    onChange={setPersonalVolume}
                  />
                  <p className="text-[10px] text-neutral-500 mt-2 leading-tight">
                    This controls the music volume only for you, independent of the room's master volume.
                  </p>
                </div>

                {/* Other Users Mic Volumes */}
                {otherClients.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                      User Mic Volumes
                    </div>
                    <div className="space-y-1 bg-black/10 p-2 rounded-md border border-white/5">
                      {otherClients.map((client) => {
                        const vol = micVolumes[client.clientId] ?? 1.0;
                        const hasStream = !!remoteStreams[client.clientId];

                        return (
                          <div
                            key={client.clientId}
                            className="p-1.5 hover:bg-white/5 rounded-md transition-colors"
                          >
                            <VolumeControl
                              icon={
                                vol === 0 ? (
                                  <VolumeX className="h-3.5 w-3.5 text-neutral-500" />
                                ) : (
                                  <Volume2 className="h-3.5 w-3.5" />
                                )
                              }
                              label={client.username}
                              value={vol}
                              onChange={(val) => setMicVolume(client.clientId, val)}
                              disabled={!hasStream}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Render Remote Audios */}
      {Object.entries(remoteStreams).map(([id, stream]) => (
        <RemoteAudio key={id} clientId={id} stream={stream} />
      ))}
    </div>
  );
};
