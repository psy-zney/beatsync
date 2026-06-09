import { create } from "zustand";
import { getClientId } from "@/lib/clientId";
import { sendWSRequest } from "@/utils/ws";
import { useGlobalStore } from "./global";
import { ClientActionEnum, WebRTCSignalUnicastType } from "@beatsync/shared";

interface WebRTCState {
  isVoiceActive: boolean;
  isDeafened: boolean;
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>; // clientId -> MediaStream
  peerConnections: Record<string, RTCPeerConnection>;

  toggleVoice: () => Promise<void>;
  toggleDeafen: () => void;
  handleSignalingMessage: (msg: WebRTCSignalUnicastType) => Promise<void>;
  handleClientJoined: (clientId: string) => void;
  handleClientLeft: (clientId: string) => void;
}

const configuration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export const useWebRTCStore = create<WebRTCState>((set, get) => ({
  isVoiceActive: false,
  isDeafened: false,
  localStream: null,
  remoteStreams: {},
  peerConnections: {},

  toggleDeafen: () => {
    set((state) => ({ isDeafened: !state.isDeafened }));
  },

  toggleVoice: async () => {
    const { isVoiceActive, localStream, peerConnections } = get();

    if (isVoiceActive) {
      // Turn off voice
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }

      // Close all connections
      Object.values(peerConnections).forEach((pc) => pc.close());

      set({
        isVoiceActive: false,
        localStream: null,
        peerConnections: {},
        remoteStreams: {},
      });
    } else {
      // Turn on voice
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        set({ isVoiceActive: true, localStream: stream });

        // Initiate connections to all existing clients in the room
        const { connectedClients } = useGlobalStore.getState();
        const myId = getClientId();

        for (const client of connectedClients) {
          if (client.clientId !== myId) {
            get().handleClientJoined(client.clientId);
          }
        }
      } catch (err) {
        console.error("Failed to get local media", err);
      }
    }
  },

  handleClientJoined: async (targetClientId: string) => {
    const { isVoiceActive, localStream, peerConnections } = get();
    if (!isVoiceActive || !localStream) return;

    // Only caller creates offer. To avoid both creating offer, we can use dictionary order of clientIds
    const myId = getClientId();
    if (myId > targetClientId) {
      // I am the caller
      const pc = new RTCPeerConnection(configuration);

      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const { socket } = useGlobalStore.getState();
          if (socket) {
            sendWSRequest({
              ws: socket,
              request: {
                type: ClientActionEnum.enum.WEBRTC_SIGNAL,
                targetClientId,
                signal: { type: "ice-candidate", candidate: event.candidate },
              },
            });
          }
        }
      };

      pc.ontrack = (event) => {
        set((state) => ({
          remoteStreams: { ...state.remoteStreams, [targetClientId]: event.streams[0] },
        }));
      };

      set((state) => ({
        peerConnections: { ...state.peerConnections, [targetClientId]: pc },
      }));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const { socket } = useGlobalStore.getState();
      if (socket) {
        sendWSRequest({
          ws: socket,
          request: {
            type: ClientActionEnum.enum.WEBRTC_SIGNAL,
            targetClientId,
            signal: { type: "offer", sdp: offer },
          },
        });
      }
    } else {
      // I am the answerer. Tell the other side to send an offer if they are ready!
      const { socket } = useGlobalStore.getState();
      if (socket) {
        sendWSRequest({
          ws: socket,
          request: {
            type: ClientActionEnum.enum.WEBRTC_SIGNAL,
            targetClientId,
            signal: { type: "request-offer" },
          },
        });
      }
    }
  },

  handleClientLeft: (clientId: string) => {
    const { peerConnections } = get();
    const pc = peerConnections[clientId];
    if (pc) {
      pc.close();

      set((state) => {
        const newPCs = { ...state.peerConnections };
        delete newPCs[clientId];

        const newStreams = { ...state.remoteStreams };
        delete newStreams[clientId];

        return { peerConnections: newPCs, remoteStreams: newStreams };
      });
    }
  },

  handleSignalingMessage: async (msg: WebRTCSignalUnicastType) => {
    const { sourceClientId, signal } = msg;
    const { isVoiceActive, localStream } = get();

    if (!isVoiceActive || !localStream) return;

    let pc = get().peerConnections[sourceClientId];

    if (signal.type === "request-offer") {
      // The other side is ready and wants me to send an offer.
      // If I am active, and myId > sourceClientId, I will initiate!
      const myId = getClientId();
      if (myId > sourceClientId) {
        get().handleClientJoined(sourceClientId);
      }
      return;
    }

    if (!pc && signal.type === "offer") {
      // Create answerer PC
      pc = new RTCPeerConnection(configuration);

      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const { socket } = useGlobalStore.getState();
          if (socket) {
            sendWSRequest({
              ws: socket,
              request: {
                type: ClientActionEnum.enum.WEBRTC_SIGNAL,
                targetClientId: sourceClientId,
                signal: { type: "ice-candidate", candidate: event.candidate },
              },
            });
          }
        }
      };

      pc.ontrack = (event) => {
        set((state) => ({
          remoteStreams: { ...state.remoteStreams, [sourceClientId]: event.streams[0] },
        }));
      };

      set((state) => ({
        peerConnections: { ...state.peerConnections, [sourceClientId]: pc },
      }));
    }

    if (!pc) return;

    try {
      if (signal.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        const { socket } = useGlobalStore.getState();
        if (socket) {
          sendWSRequest({
            ws: socket,
            request: {
              type: ClientActionEnum.enum.WEBRTC_SIGNAL,
              targetClientId: sourceClientId,
              signal: { type: "answer", sdp: answer },
            },
          });
        }
      } else if (signal.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      } else if (signal.type === "ice-candidate") {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (err) {
      console.error("Error handling signaling message", err);
    }
  },
}));
