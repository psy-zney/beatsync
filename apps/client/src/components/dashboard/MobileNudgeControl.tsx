"use client";

import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { Minus, Plus, Timer } from "lucide-react";
import { useState } from "react";
import { MetronomeButton } from "./Metronome";

const STEP_OPTIONS = [10, 50, 100] as const;

export const MobileNudgeControl = () => {
  const nudge = useGlobalStore((state) => state.nudge);
  const nudgeOffsetMs = useGlobalStore((state) => state.nudgeOffsetMs);
  const [stepIndex, setStepIndex] = useState(1); // default 50ms

  const step = STEP_OPTIONS[stepIndex];

  const cycleStep = () => {
    setStepIndex((i) => (i + 1) % STEP_OPTIONS.length);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-neutral-400 font-medium">Offset Step Size</span>
        <button
          type="button"
          className="text-[11px] font-mono text-neutral-300 hover:text-white px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/5 transition-colors cursor-pointer"
          onClick={cycleStep}
        >
          {step}ms step
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 bg-black/25 p-2 rounded-xl border border-white/5">
        <button
          type="button"
          className="text-neutral-300 hover:text-white p-2 rounded-lg bg-white/5 hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
          onClick={() => nudge({ amountMs: -step })}
          title="Nudge -step"
        >
          <Minus className="h-4 w-4" />
        </button>

        <span
          className={cn(
            "text-sm font-mono text-center tabular-nums font-semibold tracking-wider",
            nudgeOffsetMs < 0 ? "text-emerald-400" : nudgeOffsetMs > 0 ? "text-rose-400" : "text-neutral-300"
          )}
        >
          {-nudgeOffsetMs > 0 ? `+${-nudgeOffsetMs}` : -nudgeOffsetMs} ms
        </span>

        <button
          type="button"
          className="text-neutral-300 hover:text-white p-2 rounded-lg bg-white/5 hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
          onClick={() => nudge({ amountMs: step })}
          title="Nudge +step"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-white/5">
        <span className="text-xs text-neutral-400">Audio reference tick</span>
        <MetronomeButton />
      </div>
    </div>
  );
};
