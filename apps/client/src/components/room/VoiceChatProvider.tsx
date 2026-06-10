"use client";

import { useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { createContext, useContext, useState, ReactNode, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum, WebRTCSignalUnicastType } from "@beatsync/shared";

interface VoiceChatContextType {
  isConnected: boolean;
  isConnecting: boolean;
  isMuted: boolean;
  activeSpeakers: Set<string>; // Set of clientIds who are speaking
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
}

const VoiceChatContext = createContext<VoiceChatContextType | null>(null);

export const useVoiceChat = () => {
  const context = useContext(VoiceChatContext);
  if (!context) {
    throw new Error("useVoiceChat must be used within a VoiceChatProvider");
  }
  return context;
};

import { useClientId } from "@/hooks/useClientId";

// Configuration for WebRTC
const rtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

const ACTIVE_SPEAKER_THRESHOLD = 15; // Volume threshold for speaking
const ACTIVE_SPEAKER_SMOOTHING = 0.8;
const ACTIVE_SPEAKER_POLL_INTERVAL_MS = 100; // 10fps polling instead of 60fps to save CPU

// Optimize Opus SDP for highest voice quality + network resilience
const optimizeOpusSdp = (sdp: string) => {
  const rtpmapMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/);
  if (rtpmapMatch) {
    const pt = rtpmapMatch[1];
    const fmtpRegex = new RegExp(`a=fmtp:${pt} (.*)`);
    if (sdp.match(fmtpRegex)) {
      sdp = sdp.replace(
        fmtpRegex,
        `a=fmtp:${pt} $1; stereo=0; sprop-maxcapturerate=48000; maxaveragebitrate=128000; useinbandfec=1; usedtx=1`
      );
    } else {
      sdp = sdp.replace(
        `a=rtpmap:${pt} opus/48000/2\r\n`,
        `a=rtpmap:${pt} opus/48000/2\r\na=fmtp:${pt} stereo=0; sprop-maxcapturerate=48000; maxaveragebitrate=128000; useinbandfec=1; usedtx=1\r\n`
      );
    }
  }
  return sdp;
};

export const VoiceChatProvider = ({ children }: { children: ReactNode }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());
  const [remoteStreamsState, setRemoteStreamsState] = useState<Record<string, MediaStream>>({});

  const socket = useGlobalStore((state) => state.socket);
  const setOnWebRTCSignal = useGlobalStore((state) => state.setOnWebRTCSignal);
  const connectedClients = useGlobalStore((state) => state.connectedClients);
  const { clientId } = useClientId();

  const localStreamRef = useRef<MediaStream | null>(null);
  const connectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<Map<string, AnalyserNode>>(new Map());
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectedRef = useRef(false);

  // Poll for active speakers
  const pollActiveSpeakers = useCallback(() => {
    if (!isConnectedRef.current) return;

    let changed = false;
    const newActiveSpeakers = new Set(activeSpeakers);

    // Check local stream
    if (localStreamRef.current && analysersRef.current.has("local")) {
      const analyser = analysersRef.current.get("local")!;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);

      const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
      const isSpeaking = average > ACTIVE_SPEAKER_THRESHOLD;

      if (isSpeaking && !newActiveSpeakers.has("local")) {
        newActiveSpeakers.add("local");
        changed = true;
      } else if (!isSpeaking && newActiveSpeakers.has("local")) {
        newActiveSpeakers.delete("local");
        changed = true;
      }
    }

    // Check remote streams
    for (const [peerId, analyser] of analysersRef.current.entries()) {
      if (peerId === "local") continue;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);

      const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
      const isSpeaking = average > ACTIVE_SPEAKER_THRESHOLD;

      if (isSpeaking && !newActiveSpeakers.has(peerId)) {
        newActiveSpeakers.add(peerId);
        changed = true;
      } else if (!isSpeaking && newActiveSpeakers.has(peerId)) {
        newActiveSpeakers.delete(peerId);
        changed = true;
      }
    }

    if (changed) {
      setActiveSpeakers(newActiveSpeakers);
    }

    pollTimerRef.current = setTimeout(pollActiveSpeakers, ACTIVE_SPEAKER_POLL_INTERVAL_MS);
  }, [activeSpeakers]);

  // Setup Analyser for a stream
  const setupAnalyser = useCallback((stream: MediaStream, id: string) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new window.AudioContext();
      }

      const audioCtx = audioContextRef.current;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = ACTIVE_SPEAKER_SMOOTHING;
      source.connect(analyser);

      analysersRef.current.set(id, analyser);

      // We don't connect analyser to destination here!
      // Remote audio is played via HTMLAudioElement to avoid echo and manage independently
    } catch (e) {
      console.warn("Failed to setup audio analyser", e);
    }
  }, []);

  const cleanupPeer = useCallback((peerId: string) => {
    const pc = connectionsRef.current.get(peerId);
    if (pc) {
      pc.close();
      connectionsRef.current.delete(peerId);
    }
    setRemoteStreamsState((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    analysersRef.current.delete(peerId);
  }, []);

  const sendSignal = useCallback(
    (targetClientId: string, signal: unknown) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      sendWSRequest({
        ws: socket,
        request: {
          type: ClientActionEnum.enum.WEBRTC_SIGNAL,
          targetClientId,
          signal,
        },
      });
    },
    [socket]
  );

  const createPeerConnection = useCallback(
    (peerId: string, isInitiator: boolean) => {
      if (connectionsRef.current.has(peerId)) {
        return connectionsRef.current.get(peerId)!;
      }

      const pc = new RTCPeerConnection(rtcConfig);
      connectionsRef.current.set(peerId, pc);

      // Add local tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(peerId, { candidate: event.candidate });
        }
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (!stream) return;

        setRemoteStreamsState((prev) => ({
          ...prev,
          [peerId]: stream,
        }));
        setupAnalyser(stream, peerId);
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
          cleanupPeer(peerId);
        }
      };

      if (isInitiator) {
        pc.createOffer()
          .then((offer) => {
            if (offer.sdp) {
              offer.sdp = optimizeOpusSdp(offer.sdp);
            }
            return pc.setLocalDescription(offer);
          })
          .then(() => {
            sendSignal(peerId, { description: pc.localDescription });
          })
          .catch((e) => console.error("Error creating offer", e));
      }

      return pc;
    },
    [sendSignal, setupAnalyser, cleanupPeer]
  );

  // Handle incoming signals
  const handleSignal = useCallback(
    async (msg: WebRTCSignalUnicastType) => {
      if (!isConnectedRef.current) return;
      const { sourceClientId, signal } = msg;

      let pc = connectionsRef.current.get(sourceClientId);

      if (signal.description) {
        if (!pc) {
          // We received an offer from someone else, create a responder PC
          pc = createPeerConnection(sourceClientId, false);
        }

        await pc.setRemoteDescription(new RTCSessionDescription(signal.description));

        if (signal.description.type === "offer") {
          const answer = await pc.createAnswer();
          if (answer.sdp) {
            answer.sdp = optimizeOpusSdp(answer.sdp);
          }
          await pc.setLocalDescription(answer);
          sendSignal(sourceClientId, { description: pc.localDescription });
        }
      } else if (signal.candidate) {
        if (pc) {
          await pc
            .addIceCandidate(new RTCIceCandidate(signal.candidate))
            .catch((e) => console.warn("Error adding candidate", e));
        }
      }
    },
    [createPeerConnection, sendSignal]
  );

  // Register signal handler
  useEffect(() => {
    setOnWebRTCSignal(handleSignal);
    return () => setOnWebRTCSignal(null);
  }, [setOnWebRTCSignal, handleSignal]);

  // Handle clients joining/leaving to initiate connections
  useEffect(() => {
    if (!isConnectedRef.current || !clientId) return;

    const currentPeerIds = Array.from(connectionsRef.current.keys());
    const remoteClientIds = connectedClients.map((c) => c.clientId).filter((id) => id !== clientId);

    // Remove old peers
    currentPeerIds.forEach((peerId) => {
      if (!remoteClientIds.includes(peerId)) {
        cleanupPeer(peerId);
      }
    });

    // Create new peers (only if we are the "initiator" to prevent glare)
    // Simple logic: the client with the lexicographically smaller ID initiates
    remoteClientIds.forEach((peerId) => {
      if (!connectionsRef.current.has(peerId) && clientId < peerId) {
        createPeerConnection(peerId, true);
      }
    });
  }, [connectedClients, clientId, createPeerConnection, cleanupPeer]);

  const connect = useCallback(async () => {
    if (isConnectedRef.current || isConnecting) return;
    setIsConnecting(true);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
          "Access to microphone is blocked. Please ensure you are using a secure connection (HTTPS) and have granted permission."
        );
      }

      // Resume or create AudioContext during user interaction
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const audioCtx = audioContextRef.current;
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });

      localStreamRef.current = stream;
      isConnectedRef.current = true;
      setIsConnected(true);
      setIsMuted(false);

      setupAnalyser(stream, "local");
      pollTimerRef.current = setTimeout(pollActiveSpeakers, ACTIVE_SPEAKER_POLL_INTERVAL_MS);

      // Connect to all existing remote clients
      const remoteClientIds = useGlobalStore
        .getState()
        .connectedClients.map((c) => c.clientId)
        .filter((id) => id !== clientId);
      remoteClientIds.forEach((peerId) => {
        // Only initiate if our ID is smaller
        if (clientId && clientId < peerId) {
          createPeerConnection(peerId, true);
        }
      });

      toast.success("Joined Voice Chat");
    } catch (e) {
      console.error("Failed to get user media", e);
      toast.error("Microphone access denied or unavailable.");
    } finally {
      setIsConnecting(false);
    }
  }, [clientId, createPeerConnection, pollActiveSpeakers, setupAnalyser, isConnecting]);

  const disconnect = useCallback(() => {
    isConnectedRef.current = false;
    setIsConnected(false);
    setActiveSpeakers(new Set());

    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    connectionsRef.current.forEach((pc, peerId) => cleanupPeer(peerId));
    connectionsRef.current.clear();

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }
  }, [cleanupPeer]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      const newMutedState = !isMuted;
      audioTracks.forEach((track) => {
        track.enabled = !newMutedState;
      });
      setIsMuted(newMutedState);
    }
  }, [isMuted]);

  return (
    <VoiceChatContext.Provider
      value={{
        isConnected,
        isConnecting,
        isMuted,
        activeSpeakers,
        connect,
        disconnect,
        toggleMute,
      }}
    >
      {children}
      {/* Hidden audio element in DOM for iOS Safari compatibility */}
      <div style={{ display: "none" }} aria-hidden="true">
        {Object.entries(remoteStreamsState).map(([peerId, stream]) => (
          <audio
            key={peerId}
            ref={(el) => {
              if (el) {
                el.srcObject = stream;
                // @ts-ignore
                el.playsInline = true;
                el.play().catch((err) => console.warn(`Failed to play remote audio for ${peerId}`, err));
              }
            }}
            autoPlay
            controls={false}
          />
        ))}
      </div>
    </VoiceChatContext.Provider>
  );
};
