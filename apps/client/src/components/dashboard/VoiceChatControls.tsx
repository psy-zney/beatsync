"use client";

import { useClientId } from "@/hooks/useClientId";
import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { useWebRTCStore } from "@/store/webrtc";
import { Mic, MicOff, Music, Volume2, VolumeX } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { Input } from "../ui/input";

// Component to render individual remote audio
const RemoteAudio = ({ clientId, stream }: { clientId: string; stream: MediaStream }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const micVolumes = useGlobalStore((state) => state.micVolumes);

  useEffect(() => {
    if (audioRef.current && stream) {
      audioRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    if (audioRef.current) {
      const volume = micVolumes[clientId] ?? 1.0;
      audioRef.current.volume = volume;
    }
  }, [micVolumes, clientId]);

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
        <div className="flex items-center gap-1.5 text-xs text-neutral-400">
          {icon}
          <span>{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <Input
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className="h-6 w-12 text-right px-1 py-0 text-xs bg-neutral-800/50 border-neutral-700 font-mono"
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

export const VoiceChatControls = () => {
  const { clientId } = useClientId();
  const connectedClients = useGlobalStore((state) => state.connectedClients);

  const personalVolume = useGlobalStore((state) => state.personalVolume);
  const setPersonalVolume = useGlobalStore((state) => state.setPersonalVolume);
  const micVolumes = useGlobalStore((state) => state.micVolumes);
  const setMicVolume = useGlobalStore((state) => state.setMicVolume);

  const isVoiceActive = useWebRTCStore((state) => state.isVoiceActive);
  const toggleVoice = useWebRTCStore((state) => state.toggleVoice);
  const remoteStreams = useWebRTCStore((state) => state.remoteStreams);

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

  return (
    <div className="px-2">
      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="voice" className="border-b-0">
          <AccordionTrigger className="hover:no-underline py-2 px-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
            <div className="flex items-center gap-2">
              <Mic className="h-3.5 w-3.5" />
              <span>Voice & Audio</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-2 pb-3 space-y-4 pt-1">
            {/* Toggle Mic Button */}
            <Button
              variant={isVoiceActive ? "default" : "secondary"}
              size="sm"
              className="w-full flex items-center gap-2"
              onClick={toggleVoice}
            >
              {isVoiceActive ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              {isVoiceActive ? "Turn Off Mic" : "Turn On Mic"}
            </Button>

            {/* Personal Music Volume */}
            <div className="bg-neutral-800/30 p-2.5 rounded-md border border-neutral-800/50">
              <VolumeControl
                icon={<Music className="h-3.5 w-3.5" />}
                label="Your Music Volume"
                value={personalVolume}
                onChange={setPersonalVolume}
              />
            </div>

            {/* Other Users Mic Volumes */}
            {otherClients.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-neutral-500 pl-1 uppercase tracking-wider">Mic Volumes</div>
                <div className="space-y-2 bg-neutral-800/30 p-2.5 rounded-md border border-neutral-800/50">
                  {otherClients.map((client) => {
                    const vol = micVolumes[client.clientId] ?? 1.0;
                    const hasStream = !!remoteStreams[client.clientId];

                    return (
                      <div
                        key={client.clientId}
                        className="pt-1 first:pt-0 pb-1 border-b border-neutral-800/50 last:border-0 last:pb-0"
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

            {/* Render Remote Audios */}
            {Object.entries(remoteStreams).map(([id, stream]) => (
              <RemoteAudio key={id} clientId={id} stream={stream} />
            ))}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};
