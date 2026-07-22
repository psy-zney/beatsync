"use client";

import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import { useCanMutate, useGlobalStore } from "@/store/global";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum } from "@beatsync/shared";
import { ArrowDown, Search as SearchIcon, X, ZapIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { SearchResults } from "./SearchResults";
import { SpotifyImportModal } from "../SpotifyImportModal";

const SpotifyLogo = ({ className = "size-4" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm5.521 17.341c-.217.357-.68.473-1.037.256-2.856-1.745-6.452-2.14-10.686-1.171-.406.092-.811-.161-.904-.567-.092-.406.161-.811.567-.904 4.636-1.06 8.599-.607 11.804 1.353.357.217.473.68.256 1.037zm1.472-3.275c-.273.443-.852.584-1.295.312-3.268-2.008-8.25-2.59-12.115-1.417-.497.151-1.026-.134-1.177-.631-.151-.497.134-1.026.631-1.177 4.417-1.341 9.9-0.7 13.644 1.6 1.6 1.6.443.273.584.852.312 1.295zm.143-3.411c-3.921-2.328-10.39-2.544-14.154-1.399-.608.185-1.249-.166-1.434-.774-.185-.608.166-1.249.774-1.434 4.319-1.311 11.458-1.052 15.965 1.624.547.324.726 1.034.402 1.581-.324.547-1.034.726-1.581.402z" />
  </svg>
);

interface SearchForm {
  query: string;
}

export function InlineSearch() {
  const [showResults, setShowResults] = React.useState(false);
  const [isFocused, setIsFocused] = React.useState(false);
  const [isSpotifyOpen, setIsSpotifyOpen] = React.useState(false);
  const [showCheckmark, setShowCheckmark] = React.useState(false);
  const isMobile = useIsMobile();
  const blurTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const canMutate = useCanMutate();
  const socket = useGlobalStore((state) => state.socket);
  const setIsSearching = useGlobalStore((state) => state.setIsSearching);
  const setSearchQuery = useGlobalStore((state) => state.setSearchQuery);
  const setSearchOffset = useGlobalStore((state) => state.setSearchOffset);
  const setHasMoreResults = useGlobalStore((state) => state.setHasMoreResults);
  const searchResults = useGlobalStore((state) => state.searchResults);
  const isSearching = useGlobalStore((state) => state.isSearching);
  const activeStreamJobs = useGlobalStore((state) => state.activeStreamJobs);
  const { register, handleSubmit, setFocus, watch, reset } = useForm<SearchForm>({
    defaultValues: { query: "" },
  });

  // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form's watch() API is incompatible with React Compiler memoization by design
  const watchedQuery = watch("query");

  // Cleanup timeout on unmount
  React.useEffect(() => {
    const ref = blurTimeoutRef;
    return () => {
      if (ref.current) {
        clearTimeout(ref.current);
      }
    };
  }, []);

  // Add keyboard shortcuts for ⌘K to toggle focus and ESC to dismiss
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC key to dismiss search results
      if (e.key === "Escape") {
        if (showResults) {
          e.preventDefault();
          (document.activeElement as HTMLElement)?.blur();
        }
        return;
      }

      // ⌘K to toggle focus (only when user can mutate)
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();

        if (!canMutate) {
          return;
        }

        if (isFocused) {
          // Blur the currently focused element and hide results
          (document.activeElement as HTMLElement)?.blur();
          setShowResults(false);
        } else {
          // Focus the input using RHF's setFocus
          setFocus("query");
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setFocus, isFocused, canMutate, showResults]);

  // Dismiss search results when input becomes empty
  React.useEffect(() => {
    if (!watchedQuery || watchedQuery.trim() === "") {
      setShowResults(false);
    }
  }, [watchedQuery]);

  const onSubmit = (data: SearchForm) => {
    if (!canMutate) {
      return;
    }

    if (!socket) {
      console.error("WebSocket not connected");
      return;
    }

    if (!data.query || !data.query.trim()) return;

    console.log("Sending search request", data.query);

    // Reset pagination state for new search and set loading state
    setSearchOffset(0);
    setHasMoreResults(false);
    setIsSearching(true);
    setSearchQuery(data.query);
    setShowResults(true);

    sendWSRequest({
      ws: socket,
      request: {
        type: ClientActionEnum.enum.SEARCH_MUSIC,
        query: data.query,
      },
    });
  };

  const handleTrackSelection = () => {
    // Show checkmark animation
    setShowCheckmark(true);

    // Dismiss search results immediately but keep input text
    setShowResults(false);

    // Hide checkmark after 2 seconds
    setTimeout(() => {
      setShowCheckmark(false);
    }, 2000);
  };

  const handleFocus = () => {
    if (!canMutate) return;
    setIsFocused(true);
    if (watchedQuery && watchedQuery.trim() !== "") {
      setShowResults(true);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    // Clear any existing timeout
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }

    // Check if the new focus target is within our container
    if (!e.currentTarget.contains(e.relatedTarget)) {
      // On mobile, never dismiss on blur - only through explicit close button
      if (!isMobile) {
        // On desktop, hide immediately
        setShowResults(false);
      }
    }
  };

  const handleCloseResults = () => {
    setShowResults(false);
    // Clear the timeout if it exists
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }
  };

  return (
    <div
      className="relative w-full"
      onBlur={handleBlur}
      onFocus={() => {
        // Cancel any pending blur timeout when focus returns
        if (blurTimeoutRef.current) {
          clearTimeout(blurTimeoutRef.current);
        }
      }}
    >
      {/* Search Input & Spotify Button */}
      <div className="flex items-center gap-2 w-full">
        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 min-w-0">
          <div className="relative group">
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5">
              <AnimatePresence mode="wait">
                {activeStreamJobs > 0 ? (
                  <motion.div
                    key="streaming"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="flex items-center gap-1.5"
                  >
                    <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                      <svg className="w-full h-full" viewBox="0 0 100 100">
                        <motion.circle
                          cx="50"
                          cy="50"
                          r="35"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="8"
                          strokeLinecap="round"
                          className="text-green-500"
                          strokeDasharray={2 * Math.PI * 35 * 0.25}
                          animate={{
                            rotate: [0, 360],
                          }}
                          transition={{
                            duration: 1.5,
                            repeat: Infinity,
                            ease: "linear",
                          }}
                          style={{
                            transformOrigin: "center",
                          }}
                        />
                      </svg>
                    </div>
                    <span className="text-xs font-mono text-green-400 font-medium">{activeStreamJobs}</span>
                  </motion.div>
                ) : showCheckmark ? (
                  <motion.div
                    key="checkmark"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="flex items-center justify-center"
                  >
                    <SearchIcon className="w-4 h-4 text-green-500" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="search"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="flex items-center justify-center"
                  >
                    <SearchIcon
                      className={cn(
                        "w-4 h-4 transition-colors duration-200",
                        isFocused ? "text-white" : "text-neutral-400"
                      )}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <input
              {...register("query")}
              type="text"
              disabled={!canMutate}
              placeholder={canMutate ? "Search track name..." : "Admin only"}
              onFocus={handleFocus}
              onBlur={() => setIsFocused(false)}
              className={cn(
                "w-full pl-10 pr-14 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 outline-none border border-neutral-700/60 shadow-inner",
                canMutate
                  ? "bg-white/10 hover:bg-white/15 focus:bg-white/15 focus:ring-2 focus:ring-emerald-500/80 text-white placeholder:text-neutral-400"
                  : "bg-neutral-800/50 text-neutral-500 placeholder:text-neutral-600 cursor-not-allowed"
              )}
            />
            <div className="absolute right-1 top-1/2 transform -translate-y-1/2 pointer-events-none w-12 flex items-center justify-center">
              <AnimatePresence mode="wait">
                {showCheckmark ? (
                  <motion.div
                    key="checkmark"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="flex items-center justify-center"
                  >
                    <ArrowDown className="w-5 h-5 text-green-500" />
                  </motion.div>
                ) : watchedQuery ? (
                  <motion.button
                    key="clear"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      reset();
                      setShowResults(false);
                    }}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="flex items-center justify-center p-1 rounded-full hover:bg-white/10 text-neutral-400 hover:text-white pointer-events-auto transition-colors animate-in fade-in zoom-in duration-200"
                  >
                    <X className="size-4" />
                  </motion.button>
                ) : (
                  <motion.div
                    key="shortcut"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="flex items-center justify-center"
                  >
                    <kbd
                      className={cn(
                        "inline-flex h-6 items-center gap-0.5 rounded border border-neutral-600/50 bg-neutral-700/50 px-2 font-mono text-xs font-medium transition-colors duration-200",
                        canMutate ? "text-neutral-400" : "text-neutral-600 opacity-50"
                      )}
                    >
                      <span className="text-xs">⌘</span>K
                    </kbd>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </form>

        {/* Spotify Import Trigger Button */}
        <button
          type="button"
          onClick={() => setIsSpotifyOpen(true)}
          title="Nhập Playlist từ Spotify"
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-400 border border-emerald-500/30 text-xs font-semibold shadow-lg hover:shadow-emerald-500/20 transition-all shrink-0 cursor-pointer hover:scale-105 active:scale-95"
        >
          <SpotifyLogo className="size-4" />
          <span className="hidden sm:inline">Spotify</span>
        </button>
      </div>

      <SpotifyImportModal isOpen={isSpotifyOpen} onClose={() => setIsSpotifyOpen(false)} />

      {/* Beta Disclaimer */}
      <div className="mt-2 flex items-center gap-1 text-[10px] font-mono text-neutral-500 ml-0.5">
        <ZapIcon className="size-3 text-neutral-400 stroke-1" />
        <span>[EXPERIMENTAL FREE BETA]</span>
      </div>

      {/* Search Results Dropdown */}
      <AnimatePresence>
        {showResults && canMutate && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="absolute top-full mt-2 w-full bg-neutral-900/95 backdrop-blur-xl border border-neutral-700/50 rounded-2xl shadow-2xl overflow-hidden z-[60]"
          >
            {/* Mobile close button */}
            {isMobile && (
              <div className="sticky top-0 z-10 bg-neutral-900/95 backdrop-blur-xl border-b border-neutral-800/50">
                <button
                  onClick={handleCloseResults}
                  className="w-full px-4 py-3 flex items-center justify-between text-sm text-neutral-400 hover:text-white transition-colors"
                  type="button"
                >
                  <span>Search Results</span>
                  <X className="size-4" />
                </button>
              </div>
            )}

            <div
              className={cn(
                "overflow-y-auto scrollbar-thin scrollbar-thumb-rounded-md scrollbar-thumb-neutral-600/30 scrollbar-track-transparent hover:scrollbar-thumb-neutral-600/50 bg-neutral-900",
                isMobile ? "max-h-[70vh]" : "max-h-[60vh]"
              )}
            >
              {isSearching || searchResults ? (
                <SearchResults className="p-2" onTrackSelect={handleTrackSelection} />
              ) : (
                <div className="p-8 text-center">
                  <h3 className="text-lg font-medium text-white mb-2">Start typing to search</h3>
                  <p className="text-neutral-400 text-sm">Find songs, artists, and albums</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
