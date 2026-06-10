import { Button } from "@/components/ui/button";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { useVoiceChat } from "./VoiceChatProvider";

export const VoiceControls = () => {
  const { isConnected, isConnecting, isMuted, connect, disconnect, toggleMute } = useVoiceChat();

  // If not connected, show join button
  if (!isConnected) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs bg-green-500/10 text-green-500 hover:bg-green-500/20 hover:text-green-400"
        onClick={() => connect()}
        disabled={isConnecting}
      >
        <Phone className="w-3 h-3 mr-1" />
        {isConnecting ? "Connecting..." : "Join Voice"}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1 bg-neutral-900 rounded-md p-0.5 border border-neutral-800">
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
