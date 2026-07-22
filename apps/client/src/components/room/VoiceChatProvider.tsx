"use client";

import { fetchVoiceToken } from "@/lib/api";
import { useRoomStore } from "@/store/room";
import { useWebRTCStore } from "@/store/webrtc";
import { useGlobalStore } from "@/store/global";
import { useClientId } from "@/hooks/useClientId";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from "livekit-client";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface VoiceChatContextType {
  isConnected: boolean;
  isConnecting: boolean;
  isMuted: boolean;
  activeSpeakers: Set<string>;
  remoteStreams: Record<string, MediaStream>;
  localStream: MediaStream | null;
  isAINoiseSuppressionEnabled: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
  toggleAINoiseSuppression: () => void;
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

export const VoiceChatProvider = ({ children }: { children: ReactNode }) => {
  const { clientId } = useClientId();
  const roomId = useRoomStore((state) => state.roomId);
  const username = useRoomStore((state) => state.username);
  const micVolumes = useGlobalStore((state) => state.micVolumes);
  const isDeafened = useWebRTCStore((state) => state.isDeafened);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isAINoiseSuppressionEnabled, setIsAINoiseSuppressionEnabled] = useState(true);
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const roomRef = useRef<Room | null>(null);
  const remoteAudioRef = useRef<Map<string, HTMLAudioElement[]>>(new Map());
  const intentionalDisconnectRef = useRef(false);

  const clearRemoteAudio = useCallback(() => {
    remoteAudioRef.current.forEach(removeAudioElements);
    remoteAudioRef.current.clear();
    setRemoteStreams({});
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

  useEffect(() => syncRemoteVolume(), [syncRemoteVolume]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    roomRef.current?.disconnect(true);
    roomRef.current = null;
    clearRemoteAudio();
    setActiveSpeakers(new Set());
    setLocalStream(null);
    setIsMuted(true);
    setIsConnecting(false);
    setIsConnected(false);
  }, [clearRemoteAudio]);

  const connect = useCallback(async () => {
    if (isConnecting || isConnected || !clientId || !roomId || !username) return;
    setIsConnecting(true);
    intentionalDisconnectRef.current = false;

    try {
      const credentials = await fetchVoiceToken({ roomId, clientId, username });
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: isAINoiseSuppressionEnabled,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setActiveSpeakers(new Set(speakers.map((speaker) => (speaker.isLocal ? "local" : speaker.identity))));
      });
      room.on(RoomEvent.Reconnecting, () => {
        setIsConnecting(true);
        toast.message("Voice call is reconnecting…", { id: "voice-reconnecting" });
      });
      room.on(RoomEvent.Reconnected, () => {
        setIsConnecting(false);
        toast.success("Voice call reconnected", { id: "voice-reconnecting" });
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
          document.body.appendChild(element);
          const current = remoteAudioRef.current.get(participant.identity) ?? [];
          remoteAudioRef.current.set(participant.identity, [...current, element]);
          const stream = new MediaStream([track.mediaStreamTrack]);
          setRemoteStreams((previous) => ({ ...previous, [participant.identity]: stream }));
          syncRemoteVolume();
          element.play().catch(() => toast.message("Tap anywhere to enable voice playback", { id: "voice-playback" }));
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
      });
      room.on(RoomEvent.Disconnected, () => {
        if (!intentionalDisconnectRef.current) toast.error("Voice call disconnected. Please retry.");
        roomRef.current = null;
        clearRemoteAudio();
        setActiveSpeakers(new Set());
        setLocalStream(null);
        setIsMuted(true);
        setIsConnecting(false);
        setIsConnected(false);
      });

      await room.connect(credentials.serverUrl, credentials.participantToken, { autoSubscribe: true });
      await room.startAudio();
      const publication = await room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: isAINoiseSuppressionEnabled,
        autoGainControl: true,
        channelCount: 1,
      });
      roomRef.current = room;
      setLocalStream(publication?.audioTrack ? new MediaStream([publication.audioTrack.mediaStreamTrack]) : null);
      setIsMuted(false);
      setIsConnected(true);
      toast.success("Voice connected");
    } catch (error) {
      console.error("Failed to join LiveKit voice", error);
      roomRef.current?.disconnect(true);
      roomRef.current = null;
      toast.error(error instanceof Error ? error.message : "Could not join voice call");
    } finally {
      setIsConnecting(false);
    }
  }, [
    clientId,
    roomId,
    username,
    isConnecting,
    isConnected,
    isAINoiseSuppressionEnabled,
    clearRemoteAudio,
    syncRemoteVolume,
  ]);

  const toggleMute = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const nextMuted = !isMuted;
    room.localParticipant
      .setMicrophoneEnabled(!nextMuted, {
        echoCancellation: true,
        noiseSuppression: isAINoiseSuppressionEnabled,
        autoGainControl: true,
        channelCount: 1,
      })
      .then((publication) => {
        setLocalStream(publication?.audioTrack ? new MediaStream([publication.audioTrack.mediaStreamTrack]) : null);
        setIsMuted(nextMuted);
      })
      .catch(() => toast.error("Could not update microphone"));
  }, [isMuted, isAINoiseSuppressionEnabled]);

  const toggleAINoiseSuppression = useCallback(() => {
    setIsAINoiseSuppressionEnabled((value) => !value);
    toast.message("Noise suppression will apply the next time the microphone is enabled.");
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  return (
    <VoiceChatContext.Provider
      value={{
        isConnected,
        isConnecting,
        isMuted,
        activeSpeakers,
        remoteStreams,
        localStream,
        isAINoiseSuppressionEnabled,
        connect,
        disconnect,
        toggleMute,
        toggleAINoiseSuppression,
      }}
    >
      {children}
    </VoiceChatContext.Provider>
  );
};
