import type { PositionType } from "./types/basic";

// Epoch now in milliseconds (high precision)
export const epochNow = () => performance.timeOrigin + performance.now();

export function calculateEuclideanDistance(p1: PositionType, p2: PositionType): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

interface GainParams {
  client: PositionType;
  source: PositionType;
  falloff?: number;
  minGain?: number;
  maxGain?: number;
}

export function gainFromDistanceQuadratic({
  client,
  source,
  falloff = 0.001,
  minGain = 0.15,
  maxGain = 1.0,
}: GainParams): number {
  const distance = calculateEuclideanDistance(client, source);
  const gain = maxGain - falloff * distance * distance;
  return Math.max(minGain, gain);
}

export const calculateGainFromDistanceToSource = (params: GainParams) => {
  return gainFromDistanceQuadratic(params);
};
