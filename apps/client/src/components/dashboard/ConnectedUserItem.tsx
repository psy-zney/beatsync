"use client";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import { ClientDataType } from "@beatsync/shared";
import { TooltipPortal } from "@radix-ui/react-tooltip";
import { Crown, MoreVertical, MicOff, User, VolumeX } from "lucide-react";
import { motion } from "motion/react";
import { memo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export interface ConnectedUserItemProps {
  client: ClientDataType;
  isCurrentUser: boolean;
}

// Location content shared between Tooltip and Popover - extracted outside render
const LocationContent = ({ client }: { client: ClientDataType }) => (
  <div className="space-y-1.5">
    <div className="flex items-center gap-2">
      <div className="w-3 flex justify-center">
        <User className="h-3 w-3 text-muted-foreground" />
      </div>
      <p className="font-medium text-xs text-foreground">{client.username}</p>
    </div>
    {client.location ? (
      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="w-3 flex justify-center">
            <span className="text-sm">{client.location.flagEmoji}</span>
          </div>
          <span className="text-foreground/70">
            {[[client.location.city, client.location.region].filter(Boolean).join(", "), client.location.country]
              .filter(Boolean)
              .join(" • ")}
          </span>
        </div>
      </div>
    ) : (
      <div className="flex items-center gap-2">
        <div className="w-3"></div>
        <p className="text-xs text-muted-foreground/60 italic">No location data</p>
      </div>
    )}
  </div>
);

import { useVoiceChat } from "../room/VoiceChatProvider";
import { ActiveSpeakerIndicator, MicMutedIndicator } from "../room/ActiveSpeakerIndicator";
import { useRoomStore } from "@/store/room";

const getInitials = (name: string) => {
  const parts = name.trim().split(/[\s-_]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

export const ConnectedUserItem = memo<ConnectedUserItemProps>(({ client, isCurrentUser }) => {
  const isMobile = useIsMobile();
  const [showLocation, setShowLocation] = useState(false);
  const { isConnected, isReconnecting, isMuted, voiceParticipantIds, mutedParticipantIds, deafenedParticipantIds } =
    useVoiceChat();
  const roomAvatar = useRoomStore((state) => state.avatar);
  const hasJoinedVoice = isCurrentUser ? isConnected || isReconnecting : voiceParticipantIds.has(client.clientId);
  const participantIsMuted = isCurrentUser ? isMuted : mutedParticipantIds.has(client.clientId);
  const participantIsDeafened = deafenedParticipantIds.has(client.clientId);

  const avatar = client.avatar || (isCurrentUser ? roomAvatar : undefined);
  const isDataAvatar = avatar?.startsWith("data:image/");
  const isEmojiAvatar = avatar && !isDataAvatar && Array.from(avatar).length <= 4;
  const initials = getInitials(client.username);

  const avatarContent = (
    <div className="relative">
      {hasJoinedVoice && <ActiveSpeakerIndicator clientId={client.clientId} isCurrentUser={isCurrentUser} />}
      <Avatar className="h-8 w-8">
        {isDataAvatar ? (
          <AvatarImage src={avatar} className="object-cover w-full h-full" alt={client.username} />
        ) : isEmojiAvatar ? (
          <AvatarFallback className="bg-indigo-600/90 text-sm font-normal select-none">{avatar}</AvatarFallback>
        ) : (
          <AvatarFallback
            className={
              isCurrentUser
                ? "bg-indigo-600 text-white font-semibold text-xs"
                : "bg-neutral-700 text-neutral-200 font-semibold text-xs"
            }
          >
            {initials}
          </AvatarFallback>
        )}
      </Avatar>
      {hasJoinedVoice && <MicMutedIndicator clientId={client.clientId} isCurrentUser={isCurrentUser} />}
    </div>
  );

  return (
    <motion.div
      className={cn(
        "flex items-center gap-2 p-1.5 rounded-md transition-all duration-300 text-sm",
        client.isCreator ? "bg-sky-500/10" : isCurrentUser ? "bg-primary-400/10" : "bg-transparent"
      )}
      initial={{ opacity: 0.8 }}
      animate={{
        opacity: 1,
        scale: 1,
      }}
      transition={{ duration: 0.3 }}
    >
      {/* Conditionally render Tooltip (desktop) or Popover (mobile) */}
      {isMobile ? (
        <Popover open={showLocation} onOpenChange={setShowLocation}>
          <PopoverTrigger asChild>
            <button className="focus:outline-none" onClick={() => setShowLocation(!showLocation)}>
              {avatarContent}
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="center"
            className="bg-background/95 backdrop-blur-sm border-border/50 px-3 py-2 font-mono w-auto"
          >
            <LocationContent client={client} />
          </PopoverContent>
        </Popover>
      ) : (
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>{avatarContent}</TooltipTrigger>
          <TooltipPortal>
            <TooltipContent
              side="top"
              align="center"
              collisionPadding={8}
              className="bg-background/95 backdrop-blur-sm border-border/50 px-3 py-2 font-mono"
            >
              <LocationContent client={client} />
            </TooltipContent>
          </TooltipPortal>
        </Tooltip>
      )}
      <div className="flex flex-col min-w-0">
        <div className="text-xs font-medium truncate flex items-center gap-1.5">
          <span>{client.username}</span>
          {hasJoinedVoice && participantIsMuted && (
            <MicOff className="size-3 shrink-0 text-red-400" aria-label="Microphone off" />
          )}
          {hasJoinedVoice && participantIsDeafened && (
            <VolumeX className="size-3 shrink-0 text-red-400" aria-label="Audio off" />
          )}
          {client.location?.flagSvgURL && (
            <img
              src={client.location.flagSvgURL}
              alt={client.location.country || "flag"}
              className="w-3.5 h-2.5 object-cover rounded-xs opacity-90 inline-block shrink-0"
            />
          )}
        </div>
      </div>
      {(client.isCreator || isCurrentUser || hasJoinedVoice) && (
        <Badge
          variant={client.isCreator ? "default" : isCurrentUser ? "default" : "outline"}
          className={cn(
            "ml-auto text-xs shrink-0 min-w-[60px] text-center py-0 h-5",
            client.isCreator ? "bg-sky-600 text-sky-50" : isCurrentUser ? "bg-primary-600 text-primary-50" : ""
          )}
        >
          {client.isCreator ? "Creator" : isCurrentUser ? "You" : "Connected"}
        </Badge>
      )}
    </motion.div>
  );
});

ConnectedUserItem.displayName = "ConnectedUserItem";
