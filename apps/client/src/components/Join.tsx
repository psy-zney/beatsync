"use client";

import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { fetchDiscoverRooms } from "@/lib/api";
import { readRecentRooms } from "@/lib/browserLibrary";
import { readLocalProfile, saveLocalProfile, type LocalProfile } from "@/lib/profile";
import { generateRoomId, validateFullRoomId } from "@/lib/room";
import { useRoomStore } from "@/store/room";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Headphones } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ActiveRooms } from "./ActiveRooms";
import { ProfileSetup } from "./ProfileSetup";

export const Join = () => {
  const router = useRouter();
  const [roomId, setRoomId] = useState("");
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [recentRooms, setRecentRooms] = useState<string[]>([]);
  const [isJoining, setIsJoining] = useState(false);
  const { data: rooms } = useQuery({
    queryKey: ["discover-rooms"],
    queryFn: fetchDiscoverRooms,
    refetchInterval: 5000,
  });

  useEffect(() => {
    queueMicrotask(() => {
      setProfile(readLocalProfile());
      setRecentRooms(readRecentRooms());
    });
  }, []);

  const enterRoom = (nextProfile: LocalProfile, create = false) => {
    if (isJoining) return;
    const nextRoomId = create ? generateRoomId(rooms?.map((room) => room.roomId)) : roomId;
    if (!validateFullRoomId(nextRoomId)) return toast.error("Please enter a 6-digit room code.");
    try {
      saveLocalProfile(nextProfile);
    } catch {
      toast.warning("Your profile could not be saved in this browser. You can still join the room.");
    }
    useRoomStore.getState().setUsername(nextProfile.name);
    useRoomStore.getState().setAvatar(nextProfile.avatar);
    setIsJoining(true);
    router.push(`/room/${nextRoomId}`);
  };

  return (
    <ProfileSetup
      initialProfile={profile}
      onSave={(nextProfile) => enterRoom(nextProfile)}
      onCreate={(nextProfile) => enterRoom(nextProfile, true)}
      submitLabel={isJoining ? "Joining…" : "Join room"}
      disabled={isJoining}
      footer={<ActiveRooms onJoin={setRoomId} />}
    >
      <div className="my-8 flex flex-col items-center text-center">
        <Headphones className="mb-3 size-7 text-purple-400" aria-hidden="true" />
        <h2 className="text-xl font-semibold text-white">Listen together</h2>
        <p className="mt-2 text-sm text-neutral-400" id="room-code-hint">
          Enter a 6-digit code to join a room
        </p>
        <div className="mt-5">
          <InputOTP
            maxLength={6}
            value={roomId}
            onChange={(value) => setRoomId(value.replace(/\D/g, ""))}
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="Room code"
            aria-describedby="room-code-hint"
            disabled={isJoining}
          >
            <InputOTPGroup className="gap-1.5 sm:gap-2">
              {Array.from({ length: 6 }, (_, index) => (
                <InputOTPSlot
                  key={index}
                  index={index}
                  className="size-10 rounded-lg! border border-neutral-700 bg-neutral-800/50 text-xl sm:size-12"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        {recentRooms.length > 0 && (
          <div className="mt-4 flex max-w-full flex-wrap items-center justify-center gap-2">
            <span className="flex items-center gap-1 text-[11px] text-neutral-500">
              <Clock3 className="size-3" /> Recent rooms
            </span>
            {recentRooms
              .filter((id) => id.startsWith(roomId))
              .map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={isJoining}
                  onClick={() => setRoomId(id)}
                  className="rounded-md border border-neutral-800 px-2 py-1 font-mono text-xs text-neutral-300 hover:border-purple-500/50 hover:text-white"
                >
                  {id}
                </button>
              ))}
          </div>
        )}
      </div>
    </ProfileSetup>
  );
};
