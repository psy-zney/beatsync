"use client";
import { useClientId } from "@/hooks/useClientId";
import { useGlobalStore } from "@/store/global";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { calculateGainFromDistanceToSource, epochNow } from "@beatsync/shared";
import { audioContextManager } from "@/lib/audioContextManager";

export const SpatialAudioBackground = () => {
  const { clientId } = useClientId();
  const spatialConfig = useGlobalStore((state) => state.spatialConfig);
  const currentUser = useGlobalStore((state) => state.currentUser);
  const globalVolume = useGlobalStore((state) => state.globalVolume);

  // Local state just for rendering the background visuals smoothly
  const [visualGain, setVisualGain] = useState(0);

  useEffect(() => {
    if (!clientId || !spatialConfig || !currentUser) {
      setTimeout(() => setVisualGain(0), 0);
      return;
    }

    let animationFrameId: number;

    const loop = () => {
      const { centerX, centerY, radius, speed, startTime } = spatialConfig;
      const now = epochNow();

      // Calculate current angle based on elapsed time
      const elapsedMs = now - startTime;
      const angle = elapsedMs * speed;

      // Calculate listening source position
      const sourceX = centerX + radius * Math.cos(angle);
      const sourceY = centerY + radius * Math.sin(angle);
      const listeningSource = { x: sourceX, y: sourceY };

      // Calculate spatial gain for this client
      const spatialGain = calculateGainFromDistanceToSource({
        client: currentUser.position,
        source: listeningSource,
      });

      // Get latest personal volume from store
      const personalVolume = useGlobalStore.getState().personalVolume;

      // Apply to audio context
      const finalGain = globalVolume * spatialGain * personalVolume;
      // Use 0.05s ramp time for smooth continuous updates without heavy popping
      audioContextManager.setMasterGain(finalGain, 0.05);

      // Update visual state (React state might be too slow for 60fps if it triggers heavy re-renders,
      // but for this simple background it's usually fine. Alternatively, we could use MotionValues).
      setVisualGain(spatialGain);

      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [clientId, spatialConfig, currentUser, globalVolume]);

  if (!clientId || visualGain <= 0) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: visualGain }}
        transition={{ duration: 0.1 }}
        className="fixed inset-0 pointer-events-none -z-10 bg-gradient-to-br from-blue-600/50 via-pink-500/30 to-blue-400/25 blur-lg"
      />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: visualGain }}
        transition={{ duration: 0.1 }}
        className="fixed inset-0 pointer-events-none -z-10 bg-radial-gradient from-pink-600/50 via-transparent to-transparent blur-xl mix-blend-screen"
      />

      {/* Additional color spots */}
      <motion.div
        style={{ opacity: visualGain * 0.8 }}
        className="fixed top-[10%] left-[15%] w-[30vw] h-[30vw] rounded-full bg-pink-600/20 blur-3xl pointer-events-none -z-10 transition-opacity duration-100"
      />
      <motion.div
        style={{ opacity: visualGain * 0.7 }}
        className="fixed bottom-[20%] right-[10%] w-[25vw] h-[25vw] rounded-full bg-purple-600/20 blur-3xl pointer-events-none -z-10 transition-opacity duration-100"
      />
      <motion.div
        style={{ opacity: visualGain * 0.6 }}
        className="fixed top-[40%] right-[20%] w-[20vw] h-[20vw] rounded-full bg-blue-500/20 blur-3xl pointer-events-none -z-10 transition-opacity duration-100"
      />
      <motion.div
        style={{ opacity: visualGain * 0.6 }}
        className="fixed top-[30%] left-[30%] w-[15vw] h-[15vw] rounded-full bg-cyan-500/20 blur-2xl pointer-events-none -z-10 transition-opacity duration-100"
      />
      <motion.div
        style={{ opacity: visualGain * 0.5 }}
        className="fixed bottom-[35%] left-[15%] w-[18vw] h-[18vw] rounded-full bg-indigo-500/20 blur-2xl pointer-events-none -z-10 transition-opacity duration-100"
      />
    </>
  );
};
