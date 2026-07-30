import { ChatMessageType } from "@beatsync/shared";
import { create } from "zustand";

interface ChatState {
  messages: ChatMessageType[];
  newestId: number;
  notificationVolume: number;

  // Actions
  setMessages: (messages: ChatMessageType[], isFullSync: boolean, newestId: number) => void;
  addMessage: (message: ChatMessageType) => void;
  setNotificationVolume: (volume: number) => void;
  reset: () => void;
}

const getSavedNotificationVolume = () => {
  if (typeof window === "undefined") return 1;
  const savedVolume = Number(window.localStorage.getItem("beatsync-chat-notification-volume"));
  return Number.isFinite(savedVolume) ? Math.max(0, Math.min(1, savedVolume)) : 1;
};

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  newestId: 0,
  notificationVolume: getSavedNotificationVolume(),

  setMessages: (messages, isFullSync, newestId) => {
    set((state) => {
      if (isFullSync) {
        // Replace all messages with new ones
        return { messages, newestId };
      } else {
        // Only append messages newer than our current newest ID
        const newMessages = messages.filter((m) => m.id > state.newestId);
        return {
          messages: [...state.messages, ...newMessages],
          newestId: Math.max(newestId, state.newestId),
        };
      }
    });
  },

  addMessage: (message) => {
    set((state) => ({
      messages: [...state.messages, message],
      newestId: message.id,
    }));
  },

  setNotificationVolume: (volume) => {
    const safeVolume = Math.max(0, Math.min(1, volume));
    if (typeof window !== "undefined") {
      window.localStorage.setItem("beatsync-chat-notification-volume", String(safeVolume));
    }
    set({ notificationVolume: safeVolume });
  },

  reset: () => {
    set({
      messages: [],
      newestId: 0,
    });
  },
}));
