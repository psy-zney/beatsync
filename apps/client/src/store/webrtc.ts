import { create } from "zustand";

/** Local voice preferences. LiveKit owns all media transports and reconnection. */
interface VoicePreferencesState {
  isDeafened: boolean;
  toggleDeafen: () => void;
}

export const useWebRTCStore = create<VoicePreferencesState>((set) => ({
  isDeafened: false,
  toggleDeafen: () => set((state) => ({ isDeafened: !state.isDeafened })),
}));
