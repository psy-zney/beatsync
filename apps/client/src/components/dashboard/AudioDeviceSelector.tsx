"use client";

import { useWebRTCStore } from "@/store/webrtc";
import { useEffect, useState } from "react";
import { useVoiceChat } from "../room/VoiceChatProvider";
import { Mic, Headphones } from "lucide-react";

export const AudioDeviceSelector = () => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const { switchAudioInputDevice, switchAudioOutputDevice } = useVoiceChat();

  const audioInputDeviceId = useWebRTCStore((state) => state.audioInputDeviceId);
  const audioOutputDeviceId = useWebRTCStore((state) => state.audioOutputDeviceId);

  useEffect(() => {
    const fetchDevices = async () => {
      try {
        // Request permissions first to get device labels
        await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        setDevices(allDevices);
      } catch (error) {
        console.error("Failed to enumerate devices", error);
      }
    };

    fetchDevices();

    navigator.mediaDevices.addEventListener("devicechange", fetchDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", fetchDevices);
  }, []);

  const audioInputDevices = devices.filter((d) => d.kind === "audioinput");
  const audioOutputDevices = devices.filter((d) => d.kind === "audiooutput");

  return (
    <div className="space-y-3">
      <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Hardware Devices</div>
      <div className="space-y-2 bg-black/10 p-2.5 rounded-md border border-white/5">
        {/* Microphone Selector */}
        <div className="space-y-1">
          <label className="text-xs text-neutral-400 flex items-center gap-1.5">
            <Mic className="size-3.5" /> Microphone
          </label>
          <select
            value={audioInputDeviceId || "default"}
            onChange={(e) => switchAudioInputDevice(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 text-xs text-neutral-300 rounded-md px-2 py-1 outline-none focus:border-purple-500"
          >
            <option value="default">Default</option>
            {audioInputDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${device.deviceId.substring(0, 5)}...`}
              </option>
            ))}
          </select>
        </div>

        {/* Speaker Selector */}
        <div className="space-y-1">
          <label className="text-xs text-neutral-400 flex items-center gap-1.5">
            <Headphones className="size-3.5" /> Speaker / Headphones
          </label>
          <select
            value={audioOutputDeviceId || "default"}
            onChange={(e) => switchAudioOutputDevice(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-700 text-xs text-neutral-300 rounded-md px-2 py-1 outline-none focus:border-purple-500"
          >
            <option value="default">Default</option>
            {audioOutputDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Speaker ${device.deviceId.substring(0, 5)}...`}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
