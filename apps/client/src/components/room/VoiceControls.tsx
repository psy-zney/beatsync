import { Button } from "@/components/ui/button";
import { Mic, MicOff, PhoneOff, Sparkles } from "lucide-react";
import { useVoiceChat } from "./VoiceChatProvider";

export const VoiceControls = () => {
  const { isConnected, isMuted, disconnect, toggleMute, isAINoiseSuppressionEnabled, toggleAINoiseSuppression } =
    useVoiceChat();

  // If not connected, don't render anything (user automatically joins on enter)
  if (!isConnected) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 bg-neutral-900 rounded-md p-0.5 border border-neutral-800">
      <Button
        variant="ghost"
        size="icon"
        className={`h-6 w-6 rounded-sm ${isAINoiseSuppressionEnabled ? "text-yellow-400 hover:text-yellow-300" : "text-neutral-500 hover:text-neutral-400"}`}
        onClick={toggleAINoiseSuppression}
        title={isAINoiseSuppressionEnabled ? "AI Noise Suppression (ON)" : "AI Noise Suppression (OFF)"}
      >
        <Sparkles className="w-3 h-3" />
      </Button>

      <div className="w-[1px] h-3 bg-neutral-700 mx-0.5"></div>

      <Button
        variant="ghost"
        size="icon"
        className={`h-6 w-6 rounded-sm ${isMuted ? "text-red-400 hover:text-red-300" : "text-neutral-400 hover:text-white"}`}
        onClick={toggleMute}
        title={isMuted ? "Unmute" : "Mute"}
      >
        {isMuted ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
      </Button>

      <div className="w-[1px] h-3 bg-neutral-700 mx-0.5"></div>

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 rounded-sm text-red-400 hover:text-red-300 hover:bg-red-400/10"
        onClick={disconnect}
        title="Disconnect"
      >
        <PhoneOff className="w-3 h-3" />
      </Button>
    </div>
  );
};
