"use client";
import { create } from "zustand";

// Interface for just the state values (without methods)
interface RoomStateValues {
  roomId: string;
  username: string;
  avatar: string;
  isLoadingRoom: boolean;
  playlistImportOpen: boolean;
  playlistImportTab: "upload" | "saved" | "spotify" | "youtube";
}

interface RoomState extends RoomStateValues {
  setRoomId: (roomId: string) => void;
  setUsername: (username: string) => void;
  setAvatar: (avatar: string) => void;
  setIsLoading: (isLoading: boolean) => void;
  setPlaylistImportOpen: (open: boolean, tab?: "upload" | "saved" | "spotify" | "youtube") => void;
  setPlaylistImportTab: (tab: "upload" | "saved" | "spotify" | "youtube") => void;
  reset: () => void;
}

// Define initial state object
const initialState: RoomStateValues = {
  roomId: "",
  username: "",
  avatar: "🎧",
  isLoadingRoom: false,
  playlistImportOpen: false,
  playlistImportTab: "upload",
};

export const useRoomStore = create<RoomState>()((set) => ({
  // Set initial state
  ...initialState,

  // Actions
  setRoomId: (roomId) => set({ roomId }),
  setUsername: (username) => set({ username }),
  setAvatar: (avatar) => set({ avatar }),
  setIsLoading: (isLoading) => set({ isLoadingRoom: isLoading }),
  setPlaylistImportOpen: (playlistImportOpen, tab) =>
    set({
      playlistImportOpen,
      ...(tab ? { playlistImportTab: tab } : {}),
    }),
  setPlaylistImportTab: (playlistImportTab) => set({ playlistImportTab }),

  // Reset to initial state
  reset: () =>
    set((state) => ({
      ...initialState,
      username: state.username, // Preserve the current username
      avatar: state.avatar,
    })),
}));
