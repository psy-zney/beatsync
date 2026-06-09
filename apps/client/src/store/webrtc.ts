import { create } from "zustand";
import { getClientId } from "@/lib/clientId";
import { sendWSRequest } from "@/utils/ws";
import { useGlobalStore } from "./global";
import { ClientActionEnum, WebRTCSignalUnicastType } from "@beatsync/shared";

interface WebRTCState {
  isVoiceActive: boolean;
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>; // clientId -> MediaStream
  peerConnections: Record<string, RTCPeerConnection>;

  toggleVoice: () => Promise<void>;
  handleSignalingMessage: (msg: WebRTCSignalUnicastType) => Promise<void>;
  handleClientJoined: (clientId: string) => void;
  handleClientLeft: (clientId: string) => void;
}

const configuration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export const useWebRTCStore = create<WebRTCState>((set, get) => ({
  isVoiceActive: false,
  localStream: null,
  remoteStreams: {},
  peerConnections: {},

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
                signalData: { type: "ice-candidate", candidate: event.candidate },
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
            signalData: { type: "offer", sdp: offer },
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
    const { sourceClientId, signalData } = msg;
    const { isVoiceActive, localStream } = get();

    if (!isVoiceActive || !localStream) return;

    let pc = get().peerConnections[sourceClientId];

    if (!pc && signalData.type === "offer") {
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
                signalData: { type: "ice-candidate", candidate: event.candidate },
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
      if (signalData.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        const { socket } = useGlobalStore.getState();
        if (socket) {
          sendWSRequest({
            ws: socket,
            request: {
              type: ClientActionEnum.enum.WEBRTC_SIGNAL,
              targetClientId: sourceClientId,
              signalData: { type: "answer", sdp: answer },
            },
          });
        }
      } else if (signalData.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
      } else if (signalData.type === "ice-candidate") {
        await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
      }
    } catch (err) {
      console.error("Error handling signaling message", err);
    }
  },
}));
