"use client";

import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useFlyStore, type FlyMode } from "@/store/fly";
import { Headphones, MoveHorizontal, Radio } from "lucide-react";
import { motion } from "motion/react";

const ModeButton = ({ mode, label }: { mode: FlyMode; label: string }) => {
  const activeMode = useFlyStore((state) => state.mode);
  const setMode = useFlyStore((state) => state.setMode);
  return (
    <button
      type="button"
      onClick={() => setMode(mode)}
      className={cn(
        "flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors",
        activeMode === mode ? "bg-white text-black" : "bg-white/5 text-neutral-400 hover:bg-white/10"
      )}
    >
      {label}
    </button>
  );
};

export const Fly = () => {
  const enabled = useFlyStore((state) => state.enabled);
  const mode = useFlyStore((state) => state.mode);
  const width = useFlyStore((state) => state.width);
  const cycleSeconds = useFlyStore((state) => state.cycleSeconds);
  const manualPan = useFlyStore((state) => state.manualPan);
  const currentPan = useFlyStore((state) => state.currentPan);
  const setEnabled = useFlyStore((state) => state.setEnabled);
  const setWidth = useFlyStore((state) => state.setWidth);
  const setCycleSeconds = useFlyStore((state) => state.setCycleSeconds);
  const setManualPan = useFlyStore((state) => state.setManualPan);

  const position = ((currentPan + 1) / 2) * 100;
  const dominant = !enabled || Math.abs(currentPan) < 0.08 ? "CENTER" : currentPan < 0 ? "LEFT" : "RIGHT";

  return (
    <div className="space-y-5 p-4 text-white">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Radio className="size-4" /> Fly · 3D Music
          </div>
          <p className="mt-1 text-[11px] leading-4 text-neutral-500">Stereo motion dành riêng cho nhạc đang nghe.</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Bật hoặc tắt Fly 3D Music" />
      </div>

      <div
        className={cn(
          "relative overflow-hidden rounded-xl border border-white/15 bg-black p-4",
          !enabled && "opacity-45"
        )}
      >
        <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:20px_20px]" />
        <div className="relative flex items-center justify-between">
          <div className="flex flex-col items-center gap-2">
            <Headphones className={cn("size-6", currentPan < -0.08 ? "text-white" : "text-neutral-700")} />
            <span className="font-mono text-[10px]">L</span>
          </div>
          <div className="relative mx-4 h-16 flex-1">
            <div className="absolute left-0 right-0 top-1/2 h-px bg-white/30" />
            <motion.div
              className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_24px_6px_rgba(255,255,255,0.5)]"
              animate={{ left: `${position}%`, scale: enabled ? [1, 1.25, 1] : 1 }}
              transition={{ left: { duration: 0.04, ease: "linear" }, scale: { repeat: Infinity, duration: 1 } }}
            />
            <div className="absolute inset-x-0 bottom-0 flex h-4 items-end justify-center gap-1">
              {[0.25, 0.55, 1, 0.55, 0.25].map((height, index) => (
                <motion.span
                  key={index}
                  className="w-1 bg-white"
                  animate={{ height: enabled ? `${4 + height * (10 + Math.abs(currentPan) * 8)}px` : "2px" }}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Headphones className={cn("size-6", currentPan > 0.08 ? "text-white" : "text-neutral-700")} />
            <span className="font-mono text-[10px]">R</span>
          </div>
        </div>
        <div className="relative mt-3 text-center font-mono text-[10px] tracking-[0.28em] text-neutral-400">
          {dominant}
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-300">
          <MoveHorizontal className="size-3.5" /> Custom
        </div>
        <div className="flex gap-2">
          <ModeButton mode="auto" label="Auto fly" />
          <ModeButton mode="manual" label="Manual" />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-[11px] text-neutral-400">
            <span>Độ rộng stereo</span>
            <span>{Math.round(width * 100)}%</span>
          </div>
          <Slider value={[width * 100]} onValueChange={([value]) => setWidth(value / 100)} min={0} max={100} step={1} />
        </div>
        {mode === "auto" ? (
          <div className="space-y-2">
            <div className="flex justify-between text-[11px] text-neutral-400">
              <span>Tốc độ qua lại</span>
              <span>{cycleSeconds.toFixed(1)}s / vòng</span>
            </div>
            <Slider
              value={[cycleSeconds]}
              onValueChange={([value]) => setCycleSeconds(value)}
              min={2}
              max={16}
              step={0.5}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-between text-[11px] text-neutral-400">
              <span>Cân bằng thủ công</span>
              <span>
                {manualPan === 0
                  ? "C"
                  : manualPan < 0
                    ? `L ${Math.round(-manualPan * 100)}`
                    : `R ${Math.round(manualPan * 100)}`}
              </span>
            </div>
            <Slider
              value={[manualPan * 100]}
              onValueChange={([value]) => setManualPan(value / 100)}
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
