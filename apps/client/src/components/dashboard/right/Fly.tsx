"use client";

import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useFlyStore, type FlyMode, type FlyOutputDevice } from "@/store/fly";
import { Headphones, MoveHorizontal, Radio, Speaker, Sparkles } from "lucide-react";
import { motion } from "motion/react";

const ModeButton = ({ mode, label }: { mode: FlyMode; label: string }) => {
  const activeMode = useFlyStore((state) => state.mode);
  const setMode = useFlyStore((state) => state.setMode);
  return (
    <button
      type="button"
      onClick={() => setMode(mode)}
      className={cn(
        "flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-all cursor-pointer",
        activeMode === mode
          ? "bg-white text-black shadow-md font-semibold"
          : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-white"
      )}
    >
      {label}
    </button>
  );
};

const DeviceButton = ({
  device,
  label,
  icon: Icon,
}: {
  device: FlyOutputDevice;
  label: string;
  icon: typeof Headphones;
}) => {
  const activeDevice = useFlyStore((state) => state.outputDevice);
  const setOutputDevice = useFlyStore((state) => state.setOutputDevice);
  const isSelected = activeDevice === device;

  return (
    <button
      type="button"
      onClick={() => setOutputDevice(device)}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs font-medium border transition-all cursor-pointer",
        isSelected
          ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400 shadow-sm shadow-emerald-500/10 font-semibold"
          : "bg-white/[0.03] border-white/5 text-neutral-400 hover:bg-white/[0.06] hover:text-white hover:border-white/10"
      )}
    >
      <Icon className={cn("size-3.5", isSelected ? "text-emerald-400" : "text-neutral-500")} />
      <span>{label}</span>
    </button>
  );
};

export const Fly = () => {
  const enabled = useFlyStore((state) => state.enabled);
  const mode = useFlyStore((state) => state.mode);
  const outputDevice = useFlyStore((state) => state.outputDevice);
  const width = useFlyStore((state) => state.width);
  const manualPan = useFlyStore((state) => state.manualPan);
  const currentPan = useFlyStore((state) => state.currentPan);
  const currentActivity = useFlyStore((state) => state.currentActivity);
  const currentDepth = useFlyStore((state) => state.currentDepth);
  const currentElevation = useFlyStore((state) => state.currentElevation);
  const isLyricsSynced = useFlyStore((state) => state.isLyricsSynced);

  const setEnabled = useFlyStore((state) => state.setEnabled);
  const setWidth = useFlyStore((state) => state.setWidth);
  const setManualPan = useFlyStore((state) => state.setManualPan);

  const position = ((currentPan + 1) / 2) * 100;
  // Normalized 3D depth for visualization (0 is front, 1 is back)
  const normalizedZ = Math.max(0, Math.min(1, -currentDepth / 2.0));
  const dominant = !enabled || Math.abs(currentPan) < 0.08 ? "CENTER" : currentPan < 0 ? "LEFT" : "RIGHT";

  return (
    <div className="space-y-4 p-4 text-white">
      {/* 1. Header & Master Switch */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Radio className="size-4 text-emerald-400" /> Fly · 3D Spatial Audio
          </div>
          <p className="mt-1 text-[11px] leading-4 text-neutral-400">
            Split-frequency 3D audio. Sub-bass stays centered while vocals & instruments fly.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Toggle Fly 3D Spatial Audio" />
      </div>

      {/* 2. Output Mode: Headphones (HRTF) vs Speakers (Haas Stereo) */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">Listening Device</label>
        <div className="flex gap-2">
          <DeviceButton device="headphones" label="Headphones (HRTF 3D)" icon={Headphones} />
          <DeviceButton device="speakers" label="Speakers (Haas Wide)" icon={Speaker} />
        </div>
      </div>

      {/* 3. Immersive Visualizer Stage */}
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 p-4 transition-opacity",
          !enabled && "opacity-40"
        )}
      >
        <div className="absolute inset-0 opacity-15 [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:16px_16px]" />

        {/* 3D Headphones Soundstage vs Stereo Speaker Soundstage */}
        {outputDevice === "headphones" ? (
          <div className="relative py-2">
            {/* Listening orbit circle */}
            <div className="relative mx-auto h-24 w-full max-w-[240px] rounded-full border border-dashed border-emerald-500/20 flex items-center justify-center">
              {/* Center Head */}
              <div className="relative size-9 rounded-full bg-neutral-900 border border-neutral-700 flex flex-col items-center justify-center text-[9px] font-mono text-neutral-400 shadow-lg">
                <span className="text-[10px]">👤</span>
                <span className="text-[8px] text-neutral-500 -mt-0.5">YOU</span>
              </div>

              {/* Ear Markers */}
              <div className="absolute left-2 text-[10px] font-mono text-neutral-500 font-bold">L</div>
              <div className="absolute right-2 text-[10px] font-mono text-neutral-500 font-bold">R</div>
              <div className="absolute top-1 text-[8px] font-mono text-neutral-600">FRONT</div>
              <div className="absolute bottom-1 text-[8px] font-mono text-neutral-600">REAR</div>

              {/* Orbiting 3D Audio Orb */}
              <motion.div
                className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400 shadow-[0_0_18px_4px_rgba(52,211,153,0.7)]"
                animate={{
                  left: `${position}%`,
                  top: `${50 - normalizedZ * 36 - currentElevation * 15}%`,
                  scale: enabled ? 1 + currentActivity * 0.45 : 1,
                }}
                transition={{
                  left: { duration: 0.04, ease: "linear" },
                  top: { duration: 0.04, ease: "linear" },
                  scale: { duration: 0.08 },
                }}
              />
            </div>
          </div>
        ) : (
          <div className="relative py-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col items-center gap-1.5">
                <Speaker
                  className={cn(
                    "size-5 transition-colors",
                    currentPan < -0.08 ? "text-emerald-400" : "text-neutral-600"
                  )}
                />
                <span className="font-mono text-[10px] text-neutral-400">L</span>
              </div>

              <div className="relative mx-4 h-14 flex-1">
                <div className="absolute left-0 right-0 top-1/2 h-px bg-white/20" />
                <motion.div
                  className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400 shadow-[0_0_16px_4px_rgba(52,211,153,0.6)]"
                  animate={{
                    left: `${position}%`,
                    scale: enabled ? 1 + currentActivity * 0.35 : 1,
                  }}
                  transition={{ left: { duration: 0.04, ease: "linear" }, scale: { duration: 0.08 } }}
                />
                <div className="absolute inset-x-0 bottom-0 flex h-3 items-end justify-center gap-1">
                  {[0.3, 0.6, 1, 0.6, 0.3].map((height, index) => (
                    <motion.span
                      key={index}
                      className="w-1 bg-emerald-400/80 rounded-full"
                      animate={{
                        height: enabled ? `${2 + height * currentActivity * 12}px` : "2px",
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex flex-col items-center gap-1.5">
                <Speaker
                  className={cn(
                    "size-5 transition-colors",
                    currentPan > 0.08 ? "text-emerald-400" : "text-neutral-600"
                  )}
                />
                <span className="font-mono text-[10px] text-neutral-400">R</span>
              </div>
            </div>
          </div>
        )}

        {/* Direction & Status Badges */}
        <div className="relative mt-2 flex items-center justify-between border-t border-white/5 pt-2 text-[10px]">
          <div className="flex items-center gap-1 font-mono tracking-widest text-neutral-400">
            PAN: <span className="text-white font-semibold">{dominant}</span>
          </div>

          <div className="flex items-center gap-1.5">
            {isLyricsSynced ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-medium">
                <Sparkles className="size-3" /> Lyrics Synced
              </span>
            ) : mode === "auto" ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300 border border-neutral-700 text-[10px] font-medium">
                ⚡ Dynamic Flow
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* 4. Controls: Mode & Sliders */}
      <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-300">
          <MoveHorizontal className="size-3.5 text-neutral-400" /> Controls
        </div>

        <div className="flex gap-2">
          <ModeButton mode="auto" label="Follow music" />
          <ModeButton mode="manual" label="Manual" />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-[11px] text-neutral-400">
            <span>Spatial Width</span>
            <span className="font-mono text-white">{Math.round(width * 100)}%</span>
          </div>
          <Slider value={[width * 100]} onValueChange={([val]) => setWidth(val / 100)} min={0} max={100} step={1} />
        </div>

        {mode === "auto" ? (
          <p className="text-[11px] leading-4 text-neutral-400">
            Movement automatically tracks vocal phrasing, lyrics timestamps, and bass energy changes.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-between text-[11px] text-neutral-400">
              <span>Manual Balance</span>
              <span className="font-mono text-white">
                {manualPan === 0
                  ? "Center"
                  : manualPan < 0
                    ? `L ${Math.round(-manualPan * 100)}%`
                    : `R ${Math.round(manualPan * 100)}%`}
              </span>
            </div>
            <Slider
              value={[manualPan * 100]}
              onValueChange={([val]) => setManualPan(val / 100)}
              min={-100}
              max={100}
              step={1}
            />
          </div>
        )}
      </div>
    </div>
  );
};
