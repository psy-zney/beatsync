import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { Queue } from "../Queue";
import { InlineSearch } from "./InlineSearch";
import { AudioUploaderMinimal } from "../AudioUploaderMinimal";

export const Main = () => {
  return (
    <motion.div
      className={cn(
        "w-full lg:flex-1 overflow-y-auto bg-gradient-to-b from-neutral-900/90 to-neutral-950 backdrop-blur-xl bg-neutral-950 h-full",
        "scrollbar-thin scrollbar-thumb-rounded-md scrollbar-thumb-muted-foreground/10 scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground/20"
      )}
    >
      <motion.div className="p-6 pt-4">
        {/* <h1 className="text-xl font-semibold mb-8">BeatSync</h1> */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4 items-center">
          <div className="flex-1 w-full">
            <InlineSearch />
          </div>
          <div className="w-full sm:w-64">
            <AudioUploaderMinimal />
          </div>
        </div>
        <Queue className="mb-8" />
      </motion.div>
    </motion.div>
  );
};
