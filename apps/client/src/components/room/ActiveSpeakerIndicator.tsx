import { useVoiceChat } from "./VoiceChatProvider";

export const ActiveSpeakerIndicator = ({ clientId, isCurrentUser }: { clientId: string; isCurrentUser: boolean }) => {
  const { activeSpeakers } = useVoiceChat();
  const peerId = isCurrentUser ? "local" : clientId;
  const isSpeaking = activeSpeakers.has(peerId);

  if (!isSpeaking) {
    return null;
  }

  return (
    <div className="absolute -inset-0.5 border-2 border-green-500 rounded-full animate-pulse pointer-events-none"></div>
  );
};

export const MicMutedIndicator = ({ isCurrentUser }: { isCurrentUser: boolean }) => {
  const { isMuted } = useVoiceChat();

  if (!isCurrentUser || !isMuted) {
    return null;
  }

  return (
    <div className="absolute -bottom-1 -right-1 bg-red-500 rounded-full w-3 h-3 border border-neutral-900 pointer-events-none"></div>
  );
};
