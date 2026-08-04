"use client";

import { useClientId } from "@/hooks/useClientId";
import { fetchVoiceToken } from "@/lib/api";
import { useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { useWebRTCStore } from "@/store/webrtc";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const DEAFENED_ATTRIBUTE = "beatsync.deafened";
const MAX_VOICE_RECONNECT_DELAY_MS = 10_000;

interface VoiceChatContextType {
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  isMuted: boolean;
  activeSpeakers: Set<string>;
  voiceParticipantIds: Set<string>;
  mutedParticipantIds: Set<string>;
  deafenedParticipantIds: Set<string>;
  remoteStreams: Record<string, MediaStream>;
  localStream: MediaStream | null;
  isAINoiseSuppressionEnabled: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
  toggleAINoiseSuppression: () => void;
  switchAudioInputDevice: (deviceId: string) => Promise<void>;
  switchAudioOutputDevice: (deviceId: string) => Promise<void>;
}

const VoiceChatContext = createContext<VoiceChatContextType | null>(null);

export const useVoiceChat = () => {
  const context = useContext(VoiceChatContext);
  if (!context) throw new Error("useVoiceChat must be used within a VoiceChatProvider");
  return context;
};

const removeAudioElements = (elements: HTMLAudioElement[]) => {
  elements.forEach((element) => {
    element.pause();
    element.remove();
  });
};

const updateIdentitySet = (
  setter: React.Dispatch<React.SetStateAction<Set<string>>>,
  identity: string,
  shouldInclude: boolean
) => {
  setter((previous) => {
    const next = new Set(previous);
    if (shouldInclude) next.add(identity);
    else next.delete(identity);
    return next;
  });
};

export const VoiceChatProvider = ({ children }: { children: ReactNode }) => {
  const { clientId } = useClientId();
  const roomId = useRoomStore((state) => state.roomId);
  const username = useRoomStore((state) => state.username);
  const micVolumes = useGlobalStore((state) => state.micVolumes);
  const isDeafened = useWebRTCStore((state) => state.isDeafened);
  const setAudioInputDeviceId = useWebRTCStore((state) => state.setAudioInputDeviceId);
  const setAudioOutputDeviceId = useWebRTCStore((state) => state.setAudioOutputDeviceId);

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isAINoiseSuppressionEnabled, setIsAINoiseSuppressionEnabled] = useState(true);
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());
  const [voiceParticipantIds, setVoiceParticipantIds] = useState<Set<string>>(new Set());
  const [mutedParticipantIds, setMutedParticipantIds] = useState<Set<string>>(new Set());
  const [deafenedParticipantIds, setDeafenedParticipantIds] = useState<Set<string>>(new Set());
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const roomRef = useRef<Room | null>(null);
  const remoteAudioRef = useRef<Map<string, HTMLAudioElement[]>>(new Map());
  const shouldStayConnectedRef = useRef(false);
  const intentionalDisconnectRef = useRef(false);
  const connectionInFlightRef = useRef(false);
  const desiredMutedRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectInternalRef = useRef<(isRecovery: boolean) => Promise<void>>(async () => {});

  const clearRemoteAudio = useCallback(() => {
    remoteAudioRef.current.forEach(removeAudioElements);
    remoteAudioRef.current.clear();
    setRemoteStreams({});
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const syncRemoteVolume = useCallback(() => {
    remoteAudioRef.current.forEach((elements, identity) => {
      const volume = isDeafened ? 0 : Math.min(1, Math.max(0, micVolumes[identity] ?? 1));
      elements.forEach((element) => {
        element.volume = volume;
        element.muted = isDeafened;
      });
    });
  }, [isDeafened, micVolumes]);

  const resetTransientVoiceState = useCallback(() => {
    clearRemoteAudio();
    setActiveSpeakers(new Set());
    setVoiceParticipantIds(new Set());
    setMutedParticipantIds(new Set());
    setDeafenedParticipantIds(new Set());
    setLocalStream(null);
  }, [clearRemoteAudio]);

  const scheduleReconnect = useCallback(() => {
    if (!shouldStayConnectedRef.current || reconnectTimerRef.current) return;

    reconnectAttemptsRef.current += 1;
    const delay = Math.min(1_000 * 1.5 ** (reconnectAttemptsRef.current - 1), MAX_VOICE_RECONNECT_DELAY_MS);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      void connectInternalRef.current(true);
    }, delay);
  }, []);

  useEffect(() => syncRemoteVolume(), [syncRemoteVolume]);

  // A quiet two-tone cue makes call recovery noticeable without ending the call.
  useEffect(() => {
    if (!isReconnecting) return;

    let audioContext: AudioContext | null = null;
    const playReconnectCue = () => {
      try {
        audioContext ??= new AudioContext();
        const now = audioContext.currentTime;
        [0, 0.22].forEach((delay, index) => {
          const oscillator = audioContext!.createOscillator();
          const gain = audioContext!.createGain();
          oscillator.type = "sine";
          oscillator.frequency.value = index === 0 ? 620 : 520;
          gain.gain.setValueAtTime(0.0001, now + delay);
          gain.gain.exponentialRampToValueAtTime(0.06, now + delay + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.14);
          oscillator.connect(gain);
          gain.connect(audioContext!.destination);
          oscillator.start(now + delay);
          oscillator.stop(now + delay + 0.15);
        });
      } catch {
        // Some browsers block Web Audio outside a user gesture; the visual call
        // status remains available in that case.
      }
    };

    playReconnectCue();
    const interval = setInterval(playReconnectCue, 4_000);
    return () => {
      clearInterval(interval);
      audioContext?.close().catch(() => {});
    };
  }, [isReconnecting]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    shouldStayConnectedRef.current = false;
    reconnectAttemptsRef.current = 0;
    clearReconnectTimer();

    const room = roomRef.current;
    roomRef.current = null;
    room?.disconnect(true);

    resetTransientVoiceState();
    desiredMutedRef.current = true;
    connectionInFlightRef.current = false;
    setIsMuted(true);
    setIsConnecting(false);
    setIsReconnecting(false);
    setIsConnected(false);
  }, [clearReconnectTimer, resetTransientVoiceState]);

  const connectInternal = useCallback(
    async (isRecovery: boolean) => {
      if (connectionInFlightRef.current || !shouldStayConnectedRef.current || !clientId || !roomId || !username) {
        return;
      }

      connectionInFlightRef.current = true;
      intentionalDisconnectRef.current = false;
      setIsConnecting(!isRecovery);
      if (isRecovery) setIsReconnecting(true);

      let room: Room | null = null;
      try {
        const credentials = await fetchVoiceToken({ roomId, clientId, username });
        if (!shouldStayConnectedRef.current) return;

        room = new Room({
          adaptiveStream: true,
          dynacast: true,
          audioCaptureDefaults: {
            echoCancellation: true,
            noiseSuppression: isAINoiseSuppressionEnabled,
            autoGainControl: true,
            channelCount: 1,
          },
        });
        roomRef.current = room;

        room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          setActiveSpeakers(new Set(speakers.map((speaker) => (speaker.isLocal ? "local" : speaker.identity))));
        });
        room.on(RoomEvent.Reconnecting, () => {
          setIsReconnecting(true);
          toast.message("Cuộc gọi đang tự kết nối lại…", { id: "voice-reconnecting" });
        });
        room.on(RoomEvent.SignalReconnecting, () => {
          setIsReconnecting(true);
        });
        room.on(RoomEvent.Reconnected, () => {
          reconnectAttemptsRef.current = 0;
          setIsReconnecting(false);
          setIsConnected(true);
          toast.success("Cuộc gọi đã kết nối lại", { id: "voice-reconnecting" });
        });
        room.on(RoomEvent.ParticipantConnected, (participant) => {
          updateIdentitySet(setVoiceParticipantIds, participant.identity, true);
          updateIdentitySet(
            setDeafenedParticipantIds,
            participant.identity,
            participant.attributes[DEAFENED_ATTRIBUTE] === "true"
          );
        });
        room.on(RoomEvent.ParticipantAttributesChanged, (_changedAttributes, participant) => {
          updateIdentitySet(
            setDeafenedParticipantIds,
            participant.identity,
            participant.attributes[DEAFENED_ATTRIBUTE] === "true"
          );
        });
        room.on(RoomEvent.TrackMuted, (publication, participant) => {
          if (publication.kind === Track.Kind.Audio) {
            updateIdentitySet(setMutedParticipantIds, participant.identity, true);
          }
        });
        room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
          if (publication.kind === Track.Kind.Audio) {
            updateIdentitySet(setMutedParticipantIds, participant.identity, false);
          }
        });
        room.on(
          RoomEvent.TrackSubscribed,
          (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            if (track.kind !== Track.Kind.Audio) return;
            const element = track.attach() as HTMLAudioElement;
            element.autoplay = true;
            element.setAttribute("playsinline", "");
            element.dataset.livekitParticipant = participant.identity;
            element.style.display = "none";
            // Apply custom audio output device if set
            const currentOutputDeviceId = useWebRTCStore.getState().audioOutputDeviceId;
            if (currentOutputDeviceId && "setSinkId" in element) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (element as any).setSinkId(currentOutputDeviceId).catch(console.error);
            }
            document.body.appendChild(element);
            const current = remoteAudioRef.current.get(participant.identity) ?? [];
            remoteAudioRef.current.set(participant.identity, [...current, element]);
            const stream = new MediaStream([track.mediaStreamTrack]);
            setRemoteStreams((previous) => ({ ...previous, [participant.identity]: stream }));
            syncRemoteVolume();
            element
              .play()
              .catch(() => toast.message("Chạm màn hình để bật âm thanh cuộc gọi", { id: "voice-playback" }));
          }
        );
        room.on(
          RoomEvent.TrackUnsubscribed,
          (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            removeAudioElements(track.detach() as HTMLAudioElement[]);
            remoteAudioRef.current.delete(participant.identity);
            setRemoteStreams((previous) => {
              const next = { ...previous };
              delete next[participant.identity];
              return next;
            });
          }
        );
        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
          removeAudioElements(remoteAudioRef.current.get(participant.identity) ?? []);
          remoteAudioRef.current.delete(participant.identity);
          setRemoteStreams((previous) => {
            const next = { ...previous };
            delete next[participant.identity];
            return next;
          });
          updateIdentitySet(setVoiceParticipantIds, participant.identity, false);
          updateIdentitySet(setMutedParticipantIds, participant.identity, false);
          updateIdentitySet(setDeafenedParticipantIds, participant.identity, false);
        });
        room.on(RoomEvent.Disconnected, () => {
          // Ignore events from a room intentionally closed or superseded by a
          // newer reconnect attempt.
          if (roomRef.current !== room) return;
          roomRef.current = null;
          resetTransientVoiceState();

          if (!intentionalDisconnectRef.current && shouldStayConnectedRef.current) {
            setIsConnected(true);
            setIsConnecting(false);
            setIsReconnecting(true);
            toast.message("Mất tín hiệu cuộc gọi, đang tự gọi lại…", { id: "voice-reconnecting" });
            scheduleReconnect();
          } else {
            setIsConnected(false);
            setIsConnecting(false);
            setIsReconnecting(false);
          }
        });

        await room.connect(credentials.serverUrl, credentials.participantToken, { autoSubscribe: true });

        if (useWebRTCStore.getState().audioOutputDeviceId) {
          await room
            .switchActiveDevice("audiooutput", useWebRTCStore.getState().audioOutputDeviceId as string)
            .catch(console.error);
        }

        await room.startAudio();
        const publication = await room.localParticipant.setMicrophoneEnabled(!desiredMutedRef.current, {
          echoCancellation: true,
          noiseSuppression: isAINoiseSuppressionEnabled,
          autoGainControl: true,
          channelCount: 1,
          deviceId: useWebRTCStore.getState().audioInputDeviceId,
        });

        if (!shouldStayConnectedRef.current || roomRef.current !== room) {
          room.disconnect(true);
          return;
        }

        const participantIds = new Set<string>([clientId]);
        const mutedIds = new Set<string>();
        const deafenedIds = new Set<string>();
        if (desiredMutedRef.current) mutedIds.add(clientId);
        if (isDeafened) deafenedIds.add(clientId);

        room.remoteParticipants.forEach((participant) => {
          participantIds.add(participant.identity);
          if (participant.attributes[DEAFENED_ATTRIBUTE] === "true") deafenedIds.add(participant.identity);
          const isParticipantMuted = Array.from(participant.audioTrackPublications.values()).some(
            (trackPublication) => trackPublication.isMuted
          );
          if (isParticipantMuted) mutedIds.add(participant.identity);
        });

        setVoiceParticipantIds(participantIds);
        setMutedParticipantIds(mutedIds);
        setDeafenedParticipantIds(deafenedIds);
        setLocalStream(publication?.audioTrack ? new MediaStream([publication.audioTrack.mediaStreamTrack]) : null);
        setIsMuted(desiredMutedRef.current);
        setIsConnected(true);
        setIsReconnecting(false);
        reconnectAttemptsRef.current = 0;
        clearReconnectTimer();
        await room.localParticipant.setAttributes({ [DEAFENED_ATTRIBUTE]: String(isDeafened) }).catch(() => {});

        toast.success(isRecovery ? "Cuộc gọi đã tự kết nối lại" : "Đã tham gia cuộc gọi", {
          id: "voice-reconnecting",
        });
      } catch (error) {
        console.error("Failed to join LiveKit voice", error);
        if (room && roomRef.current === room) roomRef.current = null;
        room?.disconnect(true);
        resetTransientVoiceState();

        const permissionDenied =
          error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");
        if (permissionDenied) shouldStayConnectedRef.current = false;

        if (shouldStayConnectedRef.current && isRecovery) {
          setIsConnected(true);
          setIsReconnecting(true);
          scheduleReconnect();
        } else {
          shouldStayConnectedRef.current = false;
          setIsConnected(false);
          setIsReconnecting(false);
          toast.error(
            permissionDenied
              ? "Trình duyệt chưa được cấp quyền microphone."
              : error instanceof Error
                ? error.message
                : "Không thể tham gia cuộc gọi"
          );
        }
      } finally {
        connectionInFlightRef.current = false;
        setIsConnecting(false);
      }
    },
    [
      clientId,
      roomId,
      username,
      isAINoiseSuppressionEnabled,
      isDeafened,
      clearReconnectTimer,
      resetTransientVoiceState,
      scheduleReconnect,
      syncRemoteVolume,
    ]
  );

  useEffect(() => {
    connectInternalRef.current = connectInternal;
  }, [connectInternal]);

  const connect = useCallback(async () => {
    if (connectionInFlightRef.current || shouldStayConnectedRef.current) return;
    shouldStayConnectedRef.current = true;
    desiredMutedRef.current = false;
    await connectInternalRef.current(false);
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !desiredMutedRef.current;
    desiredMutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    if (clientId) updateIdentitySet(setMutedParticipantIds, clientId, nextMuted);

    const room = roomRef.current;
    if (!room) return;
    room.localParticipant
      .setMicrophoneEnabled(!nextMuted, {
        echoCancellation: true,
        noiseSuppression: isAINoiseSuppressionEnabled,
        autoGainControl: true,
        channelCount: 1,
        deviceId: useWebRTCStore.getState().audioInputDeviceId,
      })
      .then((publication) => {
        setLocalStream(publication?.audioTrack ? new MediaStream([publication.audioTrack.mediaStreamTrack]) : null);
      })
      .catch(() => {
        desiredMutedRef.current = !nextMuted;
        setIsMuted(!nextMuted);
        if (clientId) updateIdentitySet(setMutedParticipantIds, clientId, !nextMuted);
        toast.error("Không thể cập nhật microphone");
      });
  }, [clientId, isAINoiseSuppressionEnabled]);

  const toggleAINoiseSuppression = useCallback(() => {
    setIsAINoiseSuppressionEnabled((value) => !value);
    toast.message("Khử ồn sẽ được áp dụng ở lần bật microphone tiếp theo.");
  }, []);

  const switchAudioInputDevice = useCallback(
    async (deviceId: string) => {
      setAudioInputDeviceId(deviceId);
      const room = roomRef.current;
      if (room && !isMuted) {
        await room.switchActiveDevice("audioinput", deviceId).catch(() => {
          toast.error("Không thể đổi thiết bị microphone");
        });
      }
    },
    [isMuted, setAudioInputDeviceId]
  );

  const switchAudioOutputDevice = useCallback(
    async (deviceId: string) => {
      setAudioOutputDeviceId(deviceId);
      const room = roomRef.current;

      // Update all current audio elements manually as fallback
      remoteAudioRef.current.forEach((elements) => {
        elements.forEach((element) => {
          if ("setSinkId" in element) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (element as any).setSinkId(deviceId).catch(console.error);
          }
        });
      });

      if (room) {
        await room.switchActiveDevice("audiooutput", deviceId).catch(() => {
          toast.error("Không thể đổi thiết bị loa");
        });
      }
    },
    [setAudioOutputDeviceId]
  );

  useEffect(() => {
    const room = roomRef.current;
    if (!room || !isConnected) return;
    updateIdentitySet(setDeafenedParticipantIds, room.localParticipant.identity, isDeafened);
    room.localParticipant.setAttributes({ [DEAFENED_ATTRIBUTE]: String(isDeafened) }).catch(() => {});
  }, [isConnected, isDeafened]);

  useEffect(() => () => disconnect(), [disconnect]);

  return (
    <VoiceChatContext.Provider
      value={{
        isConnected,
        isConnecting,
        isReconnecting,
        isMuted,
        activeSpeakers,
        voiceParticipantIds,
        mutedParticipantIds,
        deafenedParticipantIds,
        remoteStreams,
        localStream,
        isAINoiseSuppressionEnabled,
        connect,
        disconnect,
        toggleMute,
        toggleAINoiseSuppression,
        switchAudioInputDevice,
        switchAudioOutputDevice,
      }}
    >
      {children}
    </VoiceChatContext.Provider>
  );
};
