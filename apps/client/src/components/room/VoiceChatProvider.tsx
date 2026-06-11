"use client";

import { useGlobalStore } from "@/store/global";
import { useWebRTCStore } from "@/store/webrtc";
import { createContext, useContext, useState, ReactNode, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum, WebRTCSignalUnicastType } from "@beatsync/shared";
import { useClientId } from "@/hooks/useClientId";
import type { RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";

interface VoiceChatContextType {
  isConnected: boolean;
  isConnecting: boolean;
  isMuted: boolean;
  activeSpeakers: Set<string>; // Set of clientIds who are speaking
  remoteStreams: Record<string, MediaStream>; // clientId -> MediaStream
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
  if (!context) {
    throw new Error("useVoiceChat must be used within a VoiceChatProvider");
  }
  return context;
};

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

const RemoteAudio = ({
  peerId,
  stream,
  isDeafened,
  volume,
}: {
  peerId: string;
  stream: MediaStream;
  isDeafened: boolean;
  volume: number;
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current && stream) {
      audioRef.current.srcObject = stream;
      audioRef.current.play().catch((err) => console.warn(`Failed to play remote audio for ${peerId}`, err));
    }
  }, [stream, peerId]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isDeafened ? 0 : volume;
    }
  }, [isDeafened, volume]);

  return <audio ref={audioRef} autoPlay playsInline controls={false} />;
};

export const VoiceChatProvider = ({ children }: { children: ReactNode }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isAINoiseSuppressionEnabled, setIsAINoiseSuppressionEnabled] = useState(true);
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());
  const [remoteStreamsState, setRemoteStreamsState] = useState<Record<string, MediaStream>>({});

  const rnnoiseNodeRef = useRef<RnnoiseWorkletNode | null>(null);

  const socket = useGlobalStore((state) => state.socket);
  const setOnWebRTCSignal = useGlobalStore((state) => state.setOnWebRTCSignal);
  const connectedClients = useGlobalStore((state) => state.connectedClients);
  const { clientId } = useClientId();

  const localStreamRef = useRef<MediaStream | null>(null);
  const [localStreamState, setLocalStreamState] = useState<MediaStream | null>(null);
  const connectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<Map<string, AnalyserNode>>(new Map());
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectedRef = useRef(false);
  // Ref to avoid stale closure in pollActiveSpeakers
  const activeSpeakersRef = useRef<Set<string>>(new Set());
  // ICE candidate buffer for candidates arriving before setRemoteDescription
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  // Keep activeSpeakersRef in sync with state
  useEffect(() => {
    activeSpeakersRef.current = activeSpeakers;
  }, [activeSpeakers]);

  // Poll for active speakers – uses ref to avoid stale closure (Bug #1 fix)
  const pollActiveSpeakers = useCallback(() => {
    if (!isConnectedRef.current) return;

    let changed = false;
    const current = activeSpeakersRef.current;
    const newActiveSpeakers = new Set(current);

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
  }, []); // No dependencies – uses refs only

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
    pendingCandidatesRef.current.delete(peerId);
  }, []);

  // Use ref for sendSignal to avoid stale socket closure
  const socketRef = useRef(socket);
  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  const sendSignal = useCallback(
    (targetClientId: string, signal: unknown) => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      sendWSRequest({
        ws,
        request: {
          type: ClientActionEnum.enum.WEBRTC_SIGNAL,
          targetClientId,
          signal,
        },
      });
    },
    [] // Stable – uses socketRef
  );

  const createPeerConnection = useCallback(
    (peerId: string, isInitiator: boolean) => {
      if (connectionsRef.current.has(peerId)) {
        return connectionsRef.current.get(peerId)!;
      }

      const pc = new RTCPeerConnection(rtcConfig);
      connectionsRef.current.set(peerId, pc);

      // Add local tracks if available
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      // If initiator, add a recvonly audio transceiver to trigger negotiation
      // and signal willingness to receive audio (instead of a dummy data channel)
      if (isInitiator) {
        pc.addTransceiver("audio", { direction: localStreamRef.current ? "sendrecv" : "recvonly" });
      }

      pc.onnegotiationneeded = async () => {
        try {
          if (pc.signalingState !== "stable") return;
          const offer = await pc.createOffer();
          if (offer.sdp) {
            offer.sdp = optimizeOpusSdp(offer.sdp);
          }
          await pc.setLocalDescription(offer);
          sendSignal(peerId, { description: pc.localDescription });
        } catch (e) {
          console.error("Error during negotiation", e);
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(peerId, { candidate: event.candidate });
        }
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0] || new MediaStream([event.track]);

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

      return pc;
    },
    [sendSignal, setupAnalyser, cleanupPeer]
  );

  // Flush buffered ICE candidates after setRemoteDescription succeeds
  const flushPendingCandidates = useCallback(async (pc: RTCPeerConnection, peerId: string) => {
    const pending = pendingCandidatesRef.current.get(peerId);
    if (pending && pending.length > 0) {
      for (const candidate of pending) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn("Error adding buffered candidate", e);
        }
      }
      pendingCandidatesRef.current.delete(peerId);
    }
  }, []);

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

        try {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.description));

          // Flush any ICE candidates that arrived before the description (Bug #7 fix)
          await flushPendingCandidates(pc, sourceClientId);

          if (signal.description.type === "offer") {
            const answer = await pc.createAnswer();
            if (answer.sdp) {
              answer.sdp = optimizeOpusSdp(answer.sdp);
            }
            await pc.setLocalDescription(answer);
            sendSignal(sourceClientId, { description: pc.localDescription });
          }
        } catch (e) {
          console.error("Error setting remote description", e);
        }
      } else if (signal.candidate) {
        if (pc && pc.remoteDescription) {
          // Remote description already set – add candidate directly
          await pc
            .addIceCandidate(new RTCIceCandidate(signal.candidate))
            .catch((e) => console.warn("Error adding candidate", e));
        } else {
          // Buffer candidate until setRemoteDescription completes (Bug #7 fix)
          if (!pendingCandidatesRef.current.has(sourceClientId)) {
            pendingCandidatesRef.current.set(sourceClientId, []);
          }
          pendingCandidatesRef.current.get(sourceClientId)!.push(signal.candidate);
        }
      }
    },
    [createPeerConnection, sendSignal, flushPendingCandidates]
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

  // Stabilize connect/disconnect with refs to break dependency cycle (Bug #3 fix)
  const createPeerConnectionRef = useRef(createPeerConnection);
  useEffect(() => {
    createPeerConnectionRef.current = createPeerConnection;
  }, [createPeerConnection]);

  const connect = useCallback(async () => {
    if (isConnectedRef.current) return;

    try {
      // Resume or create AudioContext during user interaction
      if (!audioContextRef.current) {
        audioContextRef.current = new (
          window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        )();
      }
      const audioCtx = audioContextRef.current;
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      // Default to muted, no local stream on initial connect
      isConnectedRef.current = true;
      setIsConnected(true);
      setIsMuted(true);

      pollTimerRef.current = setTimeout(pollActiveSpeakers, ACTIVE_SPEAKER_POLL_INTERVAL_MS);

      // Connect to all existing remote clients
      const remoteClientIds = useGlobalStore
        .getState()
        .connectedClients.map((c) => c.clientId)
        .filter((id) => id !== clientId);
      remoteClientIds.forEach((peerId) => {
        // Only initiate if our ID is smaller
        if (clientId && clientId < peerId) {
          createPeerConnectionRef.current(peerId, true);
        }
      });
    } catch (e) {
      console.error("Failed to connect WebRTC", e);
      isConnectedRef.current = false;
      setIsConnected(false);
    }
  }, [clientId, pollActiveSpeakers]); // Stable deps only

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
      setLocalStreamState(null);
    }

    connectionsRef.current.forEach((pc, peerId) => cleanupPeer(peerId));
    connectionsRef.current.clear();

    // Clean up local analyser (Bug #9 fix)
    analysersRef.current.delete("local");
    analysersRef.current.clear();

    // Clean up pending candidates
    pendingCandidatesRef.current.clear();

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

  // Auto-connect to voice chat (receive only) when entering room (Bug #3 fix)
  const hasAutoConnected = useRef(false);
  useEffect(() => {
    if (clientId && !hasAutoConnected.current) {
      hasAutoConnected.current = true;
      // Small timeout to ensure WebSocket setup completes
      const timer = setTimeout(() => {
        connect().catch((err) => console.error("Auto-connect voice chat failed:", err));
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps -- connect is stable via refs

  const enableMic = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microphone access blocked or unavailable.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: !isAINoiseSuppressionEnabled,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });

      let cleanStream = stream;

      if (isAINoiseSuppressionEnabled) {
        try {
          if (!audioContextRef.current) {
            audioContextRef.current = new window.AudioContext();
          }
          const audioCtx = audioContextRef.current;

          const { loadRnnoise, RnnoiseWorkletNode } = await import("@sapphi-red/web-noise-suppressor");

          const wasmBinary = await loadRnnoise({
            url: "/noise-suppressor/rnnoise.wasm",
            simdUrl: "/noise-suppressor/rnnoise_simd.wasm",
          });

          await audioCtx.audioWorklet.addModule("/noise-suppressor/rnnoise-processor.js");

          const rnnoiseNode = new RnnoiseWorkletNode(audioCtx, {
            maxChannels: 1,
            wasmBinary,
          });

          rnnoiseNodeRef.current = rnnoiseNode;

          const source = audioCtx.createMediaStreamSource(stream);
          const destination = audioCtx.createMediaStreamDestination();

          source.connect(rnnoiseNode);
          rnnoiseNode.connect(destination);

          cleanStream = destination.stream;
        } catch (e) {
          console.warn("Failed to initialize RNNoise AI Suppression, falling back to raw mic", e);
        }
      }

      localStreamRef.current = cleanStream;
      setLocalStreamState(cleanStream);
      setIsMuted(false);
      setupAnalyser(cleanStream, "local");

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        connectionsRef.current.forEach((pc) => {
          // Check if there's an existing sender we can replace the track on
          const audioSender = pc.getSenders().find((s) => s.track === null || s.track?.kind === "audio");
          if (audioSender) {
            // Replace track on existing sender (no renegotiation needed)
            audioSender.replaceTrack(audioTrack).catch((e) => console.warn("replaceTrack failed", e));
          } else {
            // No sender exists, add new track (will trigger negotiation)
            pc.addTrack(audioTrack, stream);
          }
        });
      }
      toast.success("Microphone Connected");
    } catch (e) {
      console.error("Failed to get user media", e);
      toast.error("Microphone access denied or unavailable.");
    }
  }, [setupAnalyser]);

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) {
      enableMic();
      return;
    }
    const audioTracks = localStreamRef.current.getAudioTracks();
    const newMutedState = !isMuted;
    audioTracks.forEach((track) => {
      track.enabled = !newMutedState;
    });
    setIsMuted(newMutedState);
  }, [isMuted, enableMic]);

  const toggleAINoiseSuppression = useCallback(() => {
    setIsAINoiseSuppressionEnabled((prev) => {
      const nextState = !prev;
      // Note: Re-enabling mic is required to apply the new state since stream pipeline changes
      // This will be handled by the user re-toggling mute, or we could automatically reconnect here
      return nextState;
    });
  }, []);

  const isDeafened = useWebRTCStore((state) => state.isDeafened);
  const micVolumes = useGlobalStore((state) => state.micVolumes);
  return (
    <VoiceChatContext.Provider
      value={{
        isConnected,
        isConnecting: false,
        isMuted,
        isAINoiseSuppressionEnabled,
        activeSpeakers,
        remoteStreams: remoteStreamsState,
        localStream: localStreamState,
        connect,
        disconnect,
        toggleMute,
        toggleAINoiseSuppression,
      }}
    >
      {children}
      {/* Hidden audio element in DOM for iOS Safari compatibility */}
      <div style={{ display: "none" }} aria-hidden="true">
        {Object.entries(remoteStreamsState).map(([peerId, stream]) => (
          <RemoteAudio
            key={peerId}
            peerId={peerId}
            stream={stream}
            isDeafened={isDeafened}
            volume={micVolumes[peerId] ?? 1.0}
          />
        ))}
      </div>
    </VoiceChatContext.Provider>
  );
};
