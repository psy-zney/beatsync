import { useEffect, useRef, useState } from "react";

export function useAudioVolume(stream: MediaStream | null) {
  const [volume, setVolume] = useState(0);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream) {
      queueMicrotask(() => setVolume(0));
      return;
    }

    let audioCtx: AudioContext;
    let source: MediaStreamAudioSourceNode;
    try {
      audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;

      source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        // Map 0-255 to 0-1
        setVolume(Math.min(1, average / 128));

        animationFrameRef.current = requestAnimationFrame(updateVolume);
      };

      updateVolume();
    } catch (e) {
      console.error("Failed to setup audio volume analyzer", e);
    }

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      try {
        if (source) source.disconnect();
        if (audioCtx && audioCtx.state !== "closed") audioCtx.close();
      } catch (e) {}
    };
  }, [stream]);

  return volume;
}
