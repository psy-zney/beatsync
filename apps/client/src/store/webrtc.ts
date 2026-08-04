import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/** Local voice preferences. LiveKit owns all media transports and reconnection. */
interface VoicePreferencesState {
  isDeafened: boolean;
  audioInputDeviceId?: string;
  audioOutputDeviceId?: string;
  toggleDeafen: () => void;
  setAudioInputDeviceId: (id: string | undefined) => void;
  setAudioOutputDeviceId: (id: string | undefined) => void;
}

export const useWebRTCStore = create<VoicePreferencesState>()(
  persist(
    (set) => ({
      isDeafened: false,
      audioInputDeviceId: undefined,
      audioOutputDeviceId: undefined,
      toggleDeafen: () => set((state) => ({ isDeafened: !state.isDeafened })),
      setAudioInputDeviceId: (id) => set({ audioInputDeviceId: id }),
      setAudioOutputDeviceId: (id) => set({ audioOutputDeviceId: id }),
    }),
    {
      name: "beatsync-webrtc-storage",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
