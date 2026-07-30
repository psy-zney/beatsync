import { useVoiceChat } from "./VoiceChatProvider";
import { MicOff } from "lucide-react";

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

export const MicMutedIndicator = ({ clientId, isCurrentUser }: { clientId: string; isCurrentUser: boolean }) => {
  const { isMuted, mutedParticipantIds } = useVoiceChat();
  const isParticipantMuted = isCurrentUser ? isMuted : mutedParticipantIds.has(clientId);

  if (!isParticipantMuted) {
    return null;
  }

  return (
    <div className="absolute -bottom-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full border border-neutral-900 bg-red-500 text-white pointer-events-none">
      <MicOff className="size-2.5" />
    </div>
  );
};
