import { cn } from "@/lib/utils";
import React from "react";

interface AudioWaveformProps {
  volume: number; // 0 to 1
  className?: string;
  barCount?: number;
}

export const AudioWaveform: React.FC<AudioWaveformProps> = ({ volume, className, barCount = 5 }) => {
  // Generate slightly randomized heights based on the current volume
  const bars = Array.from({ length: barCount }).map((_, i) => {
    // Math.sin for a wave effect across the bars
    const baseHeight = Math.max(0.1, volume);
    const variation = Math.sin((i / barCount) * Math.PI) * 0.5 + 0.5;
    // Add some pseudo-random flutter if volume is > 0
    const flutter = volume > 0.05 ? ((volume * 1000 + i * 17) % 1) * 0.2 : 0;
    const height = Math.min(1, Math.max(0.1, baseHeight * variation + flutter));

    return height;
  });

  return (
    <div className={cn("flex items-end gap-[1px] h-3", className)}>
      {bars.map((h, i) => (
        <div
          key={i}
          className="w-0.5 bg-emerald-400 rounded-full transition-all duration-75"
          style={{ height: `${h * 100}%` }}
        />
      ))}
    </div>
  );
};
