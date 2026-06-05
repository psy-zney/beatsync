"use client";
import { NewSyncer } from "@/components/NewSyncer";
import { DEMO_ROOM_ID, IS_DEMO_MODE } from "@/lib/demo";
import { useChatStore } from "@/store/chat";
import { useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const resetGlobalStore = useGlobalStore((state) => state.resetStore);
  const resetRoomStore = useRoomStore((state) => state.reset);
  const resetChatStore = useChatStore((state) => state.reset);
  const router = useRouter();

  useEffect(() => {
    if (IS_DEMO_MODE) return;
    console.log("resetting stores");
    // Reset all stores when the main page is loaded
    resetGlobalStore();
    resetRoomStore();
    resetChatStore();
  }, [resetGlobalStore, resetRoomStore, resetChatStore]);

  useEffect(() => {
    if (!IS_DEMO_MODE) {
      router.push("/room/090624");
    }
  }, [router]);

  if (IS_DEMO_MODE) {
    return <NewSyncer roomId={DEMO_ROOM_ID} />;
  }

  return null;
}
