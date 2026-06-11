"use client";

import { cn } from "@/lib/utils";
import { useCanMutate, useGlobalStore } from "@/store/global";
import { Volume1, Volume2, VolumeX, ChevronDown, Music } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { throttle } from "throttle-debounce";
import { Slider } from "../ui/slider";

import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { useClientId } from "@/hooks/useClientId";
import { useVoiceChat } from "../room/VoiceChatProvider";

interface VolumeControlProps {
  icon: React.ReactNode;
  label: string;
  value: number; // 0 to 1
  onChange: (val: number) => void;
  disabled?: boolean;
}

const VolumeControl = ({ icon, label, value, onChange, disabled = false }: VolumeControlProps) => {
  const percent = Math.round(value * 100);

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-neutral-300">
          {icon}
          <span className="truncate max-w-[120px]" title={label}>
            {label}
          </span>
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

interface GlobalVolumeControlProps {
  className?: string;
  isMobile?: boolean;
}

export const GlobalVolumeControl = ({ className, isMobile = false }: GlobalVolumeControlProps) => {
  const canMutate = useCanMutate();
  const globalVolume = useGlobalStore((state) => state.globalVolume);
  const sendGlobalVolumeUpdate = useGlobalStore((state) => state.sendGlobalVolumeUpdate);

  const { clientId } = useClientId();
  const connectedClients = useGlobalStore((state) => state.connectedClients);
  const personalVolume = useGlobalStore((state) => state.personalVolume);
  const setPersonalVolume = useGlobalStore((state) => state.setPersonalVolume);
  const micVolumes = useGlobalStore((state) => state.micVolumes);
  const setMicVolume = useGlobalStore((state) => state.setMicVolume);

  const { remoteStreams, isConnected: isVoiceActive } = useVoiceChat();

  const otherClients = connectedClients.filter((c) => c.clientId !== clientId);

  // Local state for optimistic UI updates
  const [displayVolume, setDisplayVolume] = useState(globalVolume);
  const [isDragging, setIsDragging] = useState(false);

  // Refs for smooth interpolation
  const targetVolumeRef = useRef(globalVolume);
  const currentVolumeRef = useRef(globalVolume);
  const animationFrameRef = useRef<number>(0);

  // Smooth interpolation for remote volume changes
  useEffect(() => {
    // Update target when globalVolume changes
    targetVolumeRef.current = globalVolume;

    // Don't interpolate if user is dragging
    if (isDragging) {
      return;
    }

    const animate = () => {
      // Calculate difference between target and current
      const diff = targetVolumeRef.current - currentVolumeRef.current;

      // If difference is very small, snap to target
      if (Math.abs(diff) < 0.001) {
        currentVolumeRef.current = targetVolumeRef.current;
        setDisplayVolume(currentVolumeRef.current);
        return;
      }

      // Move 20% of the way to target each frame (exponential ease-out)
      currentVolumeRef.current += diff * 0.25;
      setDisplayVolume(currentVolumeRef.current);

      // Continue animation
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    // Start animation
    animationFrameRef.current = requestAnimationFrame(animate);

    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [globalVolume, isDragging]);

  // Create throttled version of sendGlobalVolumeUpdate
  const throttledSendUpdate = useMemo(
    () =>
      throttle(50, (volume: number) => {
        sendGlobalVolumeUpdate(volume);
      }),
    [sendGlobalVolumeUpdate]
  );

  // Get appropriate volume icon - rendered as element to avoid creating components during render
  const volumeIcon = useMemo(() => {
    const volume = displayVolume * 100;
    if (volume === 0) return <VolumeX className="h-4 w-4" />;
    if (volume < 50) return <Volume1 className="h-4 w-4" />;
    return <Volume2 className="h-4 w-4" />;
  }, [displayVolume]);

  // Handle slider change (while dragging) - send updates continuously
  const handleSliderChange = useCallback(
    (value: number[]) => {
      if (!canMutate) {
        console.error("Cannot mutate global volume");
        return;
      }
      const volume = value[0] / 100;

      // Mark as dragging
      setIsDragging(true);

      // Update local state and refs immediately for smooth UI
      setDisplayVolume(volume);
      currentVolumeRef.current = volume;
      targetVolumeRef.current = volume;

      // Send throttled update to server
      throttledSendUpdate(volume);
    },
    [canMutate, throttledSendUpdate]
  );

  // Handle slider release
  const handleSliderCommit = useCallback(
    (value: number[]) => {
      if (!canMutate) return;

      // Send final value to ensure it's accurate
      const finalVolume = value[0] / 100;
      setDisplayVolume(finalVolume);
      currentVolumeRef.current = finalVolume;
      targetVolumeRef.current = finalVolume;
      sendGlobalVolumeUpdate(finalVolume);

      // Mark as no longer dragging
      setIsDragging(false);
    },
    [canMutate, sendGlobalVolumeUpdate]
  );

  // Mobile layout (vertical, like PlaybackPermissions)
  if (isMobile) {
    return (
      <div className={cn("", className)}>
        <div className="flex items-center justify-between px-4 pt-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500 flex items-center gap-2">
            <Volume2 className="h-3.5 w-3.5" />
            <span>Global Volume</span>
          </h2>
        </div>

        <div className="px-4 pb-3">
          <div className="flex items-center gap-3 mt-2.5">
            <button
              className={cn("text-neutral-400 transition-colors", canMutate ? "hover:text-white" : "opacity-50")}
              disabled={!canMutate}
            >
              {volumeIcon}
            </button>
            <Slider
              value={[displayVolume * 100]}
              min={0}
              max={100}
              step={1}
              onValueChange={handleSliderChange}
              onValueCommit={handleSliderCommit}
              disabled={!canMutate}
              className={cn("flex-1", !canMutate && "opacity-50")}
            />
          </div>
        </div>
      </div>
    );
  }

  // Desktop layout (horizontal, Spotify-style)
  return (
    <motion.div
      className={cn("flex items-center gap-2", className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2 }}
    >
      <button
        className={cn("text-neutral-400 transition-colors", canMutate ? "hover:text-white" : "opacity-50")}
        disabled={!canMutate}
        onClick={() => {
          if (!canMutate) return;
          // Toggle mute
          const newVolume = displayVolume > 0 ? 0 : 0.5;
          setDisplayVolume(newVolume);
          currentVolumeRef.current = newVolume;
          targetVolumeRef.current = newVolume;
          sendGlobalVolumeUpdate(newVolume);
        }}
      >
        {volumeIcon}
      </button>
      <div className="w-24 flex items-center">
        <Slider
          value={[displayVolume * 100]}
          min={0}
          max={100}
          step={1}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderCommit}
          disabled={!canMutate}
          className={cn("w-full", !canMutate && "opacity-50")}
        />
      </div>

      {/* Voice & Audio Settings Popover with ChevronDown icon */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-md hover:bg-white/10 text-neutral-400 hover:text-neutral-200 transition-colors"
            title="Voice & Audio Settings"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          className="w-72 bg-[#2b2d31] border-neutral-800 p-0 shadow-xl overflow-hidden z-50"
        >
          <div className="p-3 bg-black/20 border-b border-neutral-800/50">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Voice & Audio Settings</h3>
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
            </div>

            {/* Other Users Mic Volumes */}
            {otherClients.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">User Mic Volumes</div>
                <div className="space-y-1 bg-black/10 p-2 rounded-md border border-white/5">
                  {otherClients.map((client) => {
                    const vol = micVolumes[client.clientId] ?? 1.0;
                    const hasStream = isVoiceActive && !!remoteStreams[client.clientId];

                    return (
                      <div key={client.clientId} className="p-1.5 hover:bg-white/5 rounded-md transition-colors">
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
    </motion.div>
  );
};
