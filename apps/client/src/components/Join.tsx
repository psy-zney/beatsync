"use client";

import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { fetchDiscoverRooms } from "@/lib/api";
import { readRecentRooms } from "@/lib/browserLibrary";
import { readLocalProfile, saveLocalProfile, type LocalProfile } from "@/lib/profile";
import { generateRoomId, validateFullRoomId } from "@/lib/room";
import { useRoomStore } from "@/store/room";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ActiveRooms } from "./ActiveRooms";
import { ProfileSetup } from "./ProfileSetup";

export const Join = () => {
  const router = useRouter();
  const [roomId, setRoomId] = useState("");
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [recentRooms, setRecentRooms] = useState<string[]>([]);
  const [isJoining, setIsJoining] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const roomIdRef = useRef("");
  const joiningRef = useRef(false);
  const animatingRef = useRef(false);
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(
    () => () => {
      if (animationTimerRef.current) clearTimeout(animationTimerRef.current);
      if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
    },
    []
  );

  const setCode = (value: string) => {
    roomIdRef.current = value;
    setRoomId(value);
  };

  const submitFullCode = () => {
    setIsCompleting(true);
    // Let the final digit and loading state render before changing pages.
    submitTimerRef.current = setTimeout(() => {
      submitTimerRef.current = null;
      const form = document.getElementById("profile-setup-form") as HTMLFormElement | null;
      if (form) form.requestSubmit();
      else setIsCompleting(false);
    }, 100);
  };

  const animateRoomCode = (code: string) => {
    if (!validateFullRoomId(code) || joiningRef.current || animatingRef.current || isCompleting) return;
    animatingRef.current = true;
    setIsAnimating(true);
    setCode("");
    let digit = 0;
    const revealNextDigit = () => {
      digit += 1;
      setCode(code.slice(0, digit));
      if (digit === code.length) {
        animatingRef.current = false;
        setIsAnimating(false);
        submitFullCode();
      } else {
        animationTimerRef.current = setTimeout(revealNextDigit, 90);
      }
    };
    animationTimerRef.current = setTimeout(revealNextDigit, 70);
  };

  const enterRoom = (nextProfile: LocalProfile, create = false) => {
    if (joiningRef.current || animatingRef.current) return;
    const nextRoomId = create ? generateRoomId(rooms?.map((room) => room.roomId)) : roomIdRef.current;
    if (!validateFullRoomId(nextRoomId)) return toast.error("Please enter a 6-digit room code.");
    try {
      saveLocalProfile(nextProfile);
    } catch {
      toast.warning("Your profile could not be saved in this browser. You can still join the room.");
    }
    useRoomStore.getState().setUsername(nextProfile.name);
    useRoomStore.getState().setAvatar(nextProfile.avatar);
    joiningRef.current = true;
    setIsJoining(true);
    router.push(`/room/${nextRoomId}`);
  };

  return (
    <ProfileSetup
      initialProfile={profile}
      onSave={(nextProfile) => enterRoom(nextProfile)}
      onCreate={(nextProfile) => enterRoom(nextProfile, true)}
      onValidationError={() => setIsCompleting(false)}
      showHeader={false}
      showSubmitButton={false}
      createDisabled={isAnimating || isCompleting}
      disabled={isJoining}
      footer={<ActiveRooms onJoin={animateRoomCode} />}
    >
      <div className="mt-10 flex flex-col items-center text-center">
        <h1 className="flex items-center justify-center gap-2 text-xl font-semibold text-white" aria-live="polite">
          {isCompleting || isJoining ? (
            <>
              <Loader2 className="size-5 animate-spin text-purple-400" aria-hidden="true" />
              Joining room…
            </>
          ) : (
            "Join a Beatsync Room"
          )}
        </h1>
        <p className="mt-2 text-sm text-neutral-400" id="room-code-hint">
          Enter a 6-digit code or create a new room
        </p>
        <div className="mt-6">
          <InputOTP
            maxLength={6}
            value={roomId}
            onChange={(value) => {
              if (isAnimating || isCompleting) return;
              const val = value.replace(/\D/g, "");
              setCode(val);
              if (val.length === 6) submitFullCode();
            }}
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="Room code"
            aria-describedby="room-code-hint"
            readOnly={isAnimating}
            disabled={isJoining || isCompleting}
          >
            <InputOTPGroup className="gap-1.5 sm:gap-2">
              {Array.from({ length: 6 }, (_, index) => (
                <InputOTPSlot
                  key={index}
                  index={index}
                  className={`size-11 rounded-xl! border! border-neutral-700 bg-neutral-800/70 font-mono text-xl font-medium tabular-nums text-white transition-all duration-150 sm:size-12 data-[active=true]:border-purple-400 data-[active=true]:ring-purple-500/20 ${roomId.length > index ? "border-purple-500/40 bg-purple-500/10" : ""} ${isAnimating && roomId.length === index + 1 ? "scale-110 border-purple-400 shadow-[0_0_16px_rgba(168,85,247,0.25)]" : ""}`}
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        {recentRooms.length > 0 && (
          <div className="mt-5 flex max-w-full flex-wrap items-center justify-center gap-2">
            <span className="flex items-center gap-1 text-[11px] text-neutral-500">
              <Clock3 className="size-3" /> Recent rooms
            </span>
            {recentRooms
              .filter((id) => id.startsWith(roomId))
              .map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={isJoining || isAnimating || isCompleting}
                  onClick={() => animateRoomCode(id)}
                  className="rounded-lg border border-neutral-700/70 bg-neutral-800/60 px-2.5 py-1.5 font-mono text-xs text-neutral-200 transition-colors hover:border-purple-500/60 hover:bg-purple-500/10 hover:text-white disabled:opacity-50"
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
