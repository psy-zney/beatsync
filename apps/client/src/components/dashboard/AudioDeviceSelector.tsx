"use client";

import { useWebRTCStore } from "@/store/webrtc";
import { AlertTriangle, Headphones, Laptop, Mic, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useVoiceChat } from "../room/VoiceChatProvider";

const BUILT_IN_MIC = /macbook|built[- ]?in|internal microphone|microphone.*mac/i;
const HEADSET_MIC = /airpods|bluetooth|headset|hands[- ]?free|buds|wh-|wf-|bose|beats|jabra|soundcore/i;

export const AudioDeviceSelector = () => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { switchAudioInputDevice, switchAudioOutputDevice } = useVoiceChat();

  const audioInputDeviceId = useWebRTCStore((state) => state.audioInputDeviceId);
  const audioOutputDeviceId = useWebRTCStore((state) => state.audioOutputDeviceId);

  const fetchDevices = useCallback(async () => {
    setIsRefreshing(true);
    try {
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch (error) {
      console.error("Failed to enumerate devices", error);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchDevices();
    navigator.mediaDevices.addEventListener("devicechange", fetchDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", fetchDevices);
  }, [fetchDevices]);

  const audioInputDevices = useMemo(() => devices.filter((device) => device.kind === "audioinput"), [devices]);
  const audioOutputDevices = useMemo(() => devices.filter((device) => device.kind === "audiooutput"), [devices]);
  const preferredMacMic = audioInputDevices.find((device) => BUILT_IN_MIC.test(device.label));
  const selectedInput = audioInputDevices.find((device) => device.deviceId === audioInputDeviceId);
  const selectedOutput = audioOutputDevices.find((device) => device.deviceId === audioOutputDeviceId);
  const headsetMicSelected = Boolean(selectedInput?.label && HEADSET_MIC.test(selectedInput.label));
  const bluetoothOutputSelected = Boolean(selectedOutput?.label && HEADSET_MIC.test(selectedOutput.label));
  const showBluetoothWarning = headsetMicSelected || (audioInputDeviceId === "default" && bluetoothOutputSelected);

  useEffect(() => {
    const isMac = /Macintosh|Mac OS X/.test(navigator.userAgent);
    const selectedDeviceStillExists = audioInputDevices.some((device) => device.deviceId === audioInputDeviceId);
    if (
      isMac &&
      preferredMacMic &&
      (!audioInputDeviceId || (!selectedDeviceStillExists && audioInputDeviceId !== "none"))
    ) {
      void switchAudioInputDevice(preferredMacMic.deviceId);
    }
  }, [audioInputDeviceId, audioInputDevices, preferredMacMic, switchAudioInputDevice]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Hardware Devices</div>
        <button
          type="button"
          onClick={() => void fetchDevices()}
          className="text-neutral-500 hover:text-white"
          title="Quét lại thiết bị"
        >
          <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="space-y-3 rounded-md border border-white/5 bg-black/10 p-2.5">
        <div className="space-y-1">
          <label className="flex items-center gap-1.5 text-xs text-neutral-400">
            <Mic className="size-3.5" /> Microphone
          </label>
          <select
            value={audioInputDeviceId || "default"}
            onChange={(event) => void switchAudioInputDevice(event.target.value)}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 outline-none focus:border-purple-500"
          >
            <option value="none">Không dùng mic · giữ nhạc chất lượng cao</option>
            <option value="default">Mặc định hệ thống</option>
            {audioInputDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${device.deviceId.substring(0, 5)}…`}
                {device.deviceId === preferredMacMic?.deviceId ? " · khuyên dùng" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="flex items-center gap-1.5 text-xs text-neutral-400">
            <Headphones className="size-3.5" /> Speaker / Headphones
          </label>
          <select
            value={audioOutputDeviceId || "default"}
            onChange={(event) => void switchAudioOutputDevice(event.target.value)}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 outline-none focus:border-purple-500"
          >
            <option value="default">Mặc định hệ thống</option>
            {audioOutputDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Speaker ${device.deviceId.substring(0, 5)}…`}
              </option>
            ))}
          </select>
        </div>

        {showBluetoothWarning && (
          <div className="space-y-2 rounded-md border border-amber-400/25 bg-amber-400/10 p-2 text-[11px] leading-4 text-amber-100">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Mic tai nghe Bluetooth có thể buộc macOS chuyển sang chế độ đàm thoại và làm giảm chất lượng nhạc.
              </span>
            </div>
            {preferredMacMic && (
              <button
                type="button"
                onClick={() => void switchAudioInputDevice(preferredMacMic.deviceId)}
                className="flex w-full items-center justify-center gap-1.5 rounded bg-white px-2 py-1.5 font-semibold text-black hover:bg-neutral-200"
              >
                <Laptop className="size-3.5" /> Dùng mic của Mac
              </button>
            )}
          </div>
        )}

        <p className="text-[10px] leading-4 text-neutral-600">
          Đổi Speaker áp dụng cho cả nhạc và voice trên trình duyệt có hỗ trợ. Safari có thể vẫn theo đầu ra của macOS.
        </p>
      </div>
    </div>
  );
};
