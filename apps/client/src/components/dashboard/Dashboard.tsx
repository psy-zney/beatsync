"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingEtaOverlay } from "@/components/LoadingEtaOverlay";
import { useGlobalStore } from "@/store/global";
import { Library, ListMusic, PartyPopper } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { TopBar } from "../room/TopBar";
import { ConnectionStatusBanner } from "../room/ConnectionStatusBanner";
import { BeatFlash } from "./BeatFlash";
import { Bottom } from "./Bottom";
import { Left } from "./Left";
import { Main } from "./Main";
import { Right } from "./Right";

interface DashboardProps {
  roomId: string;
}

export const Dashboard = ({ roomId }: DashboardProps) => {
  const isSynced = useGlobalStore((state) => state.isSynced);
  const isLoadingAudio = useGlobalStore((state) => state.isInitingSystem);
  const hasUserStartedSystem = useGlobalStore((state) => state.hasUserStartedSystem);

  // Once the user has entered the app, never unmount the dashboard because of
  // a short WebSocket outage. Keeping it mounted preserves UI state and decoded
  // AudioBuffers already held in browser RAM.
  const isReady = !isLoadingAudio && (isSynced || hasUserStartedSystem);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: 0.5,
        staggerChildren: 0.1,
      },
    },
  };

  return (
    <div className="w-full h-dvh flex flex-col text-white bg-neutral-950">
      <BeatFlash />
      <LoadingEtaOverlay />
      <ConnectionStatusBanner />
      {/* Top bar: Fixed height */}
      <TopBar roomId={roomId} />

      {isReady && (
        <motion.div
          className="flex flex-1 flex-col overflow-hidden min-h-0"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* --- DESKTOP LAYOUT (lg+) --- */}
          <div className="hidden lg:flex lg:flex-1 lg:overflow-hidden min-h-0">
            <Left className="flex" />
            <Main />
            <Right />
          </div>

          {/* --- MOBILE LAYOUT (< lg) --- */}
          <div className="flex flex-1 flex-col lg:hidden min-h-0">
            <Tabs defaultValue="queue" className="flex-1 flex flex-col overflow-hidden min-h-0">
              {/* Tab List at the top for mobile */}
              <TabsList className="shrink-0 grid w-full grid-cols-3 h-12 rounded-none p-0 bg-gradient-to-r from-neutral-950 via-neutral-900 to-neutral-950">
                <TabsTrigger
                  value="library"
                  className="flex-1 data-[state=active]:bg-white/5 data-[state=active]:shadow-none rounded-none text-xs h-full gap-1 text-neutral-400 data-[state=active]:text-white transition-all duration-200"
                >
                  <Library size={16} /> Session
                </TabsTrigger>
                <TabsTrigger
                  value="queue"
                  className="flex-1 data-[state=active]:bg-white/5 data-[state=active]:shadow-none rounded-none text-xs h-full gap-1 text-neutral-400 data-[state=active]:text-white transition-all duration-200"
                >
                  <ListMusic size={16} /> Music
                </TabsTrigger>
                <TabsTrigger
                  value="spatial"
                  className="flex-1 data-[state=active]:bg-white/5 data-[state=active]:shadow-none rounded-none text-xs h-full gap-1 text-neutral-400 data-[state=active]:text-white transition-all duration-200"
                >
                  <PartyPopper className="h-4 w-4" /> Fun
                </TabsTrigger>
              </TabsList>

              {/* Tab Content Area - Scrolls independently */}
              <AnimatePresence mode="sync">
                <TabsContent key="library" value="library" className="flex-1 overflow-y-auto mt-0 min-h-0">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3 }}
                    className="h-full"
                  >
                    <Left className="flex h-full w-full" />
                  </motion.div>
                </TabsContent>
                <TabsContent key="queue" value="queue" className="flex-1 overflow-y-auto mt-0 min-h-0">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3 }}
                    className="h-full"
                  >
                    <Main />
                  </motion.div>
                </TabsContent>
                <TabsContent key="spatial" value="spatial" className="flex-1 overflow-y-auto mt-0 min-h-0">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3 }}
                    className="h-full"
                  >
                    <Right />
                  </motion.div>
                </TabsContent>
              </AnimatePresence>
            </Tabs>
          </div>

          {/* Bottom Player: Fixed height, outside the scrollable/tab area */}
          <Bottom />
        </motion.div>
      )}
    </div>
  );
};
