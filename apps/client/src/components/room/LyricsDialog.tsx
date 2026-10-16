"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getCurrentLineIndex, getLyricsLines, getLyricFrameKey, type LrcLine } from "@/lib/lrc";
import { buildLyricsQuery, lyricsFromRecord, lyricsFromText, searchLyrics, type LyricsRecord } from "@/lib/lyrics";
import { cn, extractFileNameFromUrl, formatTime } from "@/lib/utils";
import { useCanMutate, useGlobalStore } from "@/store/global";
import { sendWSRequest } from "@/utils/ws";
import { MAX_LYRICS_BYTES, type TrackLyricsType } from "@beatsync/shared";
import { useQuery } from "@tanstack/react-query";
import {
  FileUp,
  Loader2,
  Minus,
  Music2,
  Pause,
  Play,
  Plus,
  Search,
  SkipForward,
  Sparkles,
  RotateCw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

function shareLyrics(url: string, lyrics: TrackLyricsType | null, onlyIfEmpty = false): boolean {
  if (lyrics && !onlyIfEmpty) lyrics = { ...lyrics, automatic: false, resolverVersion: 6 };
  const ws = useGlobalStore.getState().socket;
  if (!ws || !sendWSRequest({ ws, request: { type: "SET_TRACK_LYRICS", audioSource: url, lyrics, onlyIfEmpty } })) {
    if (!onlyIfEmpty) toast.error("Reconnect to the room before editing lyrics.");
    return false;
  }
  return true;
}

export function LyricsControls() {
  const [open, setOpen] = useState(false);
  const url = useGlobalStore((state) => state.selectedAudioUrl);
  const source = useGlobalStore((state) => state.audioSources.find((track) => track.source.url === url)?.source);
  const title = source?.title || (url ? extractFileNameFromUrl(url) : "Select a track");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="mt-2 flex justify-center gap-2">
        <DialogTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs text-neutral-400 hover:text-white"
            disabled={!source}
          >
            <Music2 className="size-3.5" /> Lyrics
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent className="flex h-[min(42rem,85dvh)] flex-col overflow-hidden border-neutral-800 bg-neutral-950 p-4 text-white sm:max-w-3xl sm:p-6">
        <div className="shrink-0 pr-8">
          <DialogTitle className="truncate leading-normal">{title}</DialogTitle>
          <DialogDescription>Lyrics automatically sync with the room&apos;s playback.</DialogDescription>
        </div>
        {source ? (
          <LyricsSession key={url} url={url} title={title} lyrics={source.lyrics} lyricsState={source.lyricsState} />
        ) : (
          <p className="my-auto text-center text-neutral-400">Select a track from the playlist to view lyrics.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function getProviderInfo(lyrics: TrackLyricsType) {
  switch (lyrics.provider) {
    case "youtube-manual":
      return {
        label: "YouTube Subtitles (Creator)",
        className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      };
    case "youtube-auto":
      return {
        label: "YouTube Subtitles (Auto)",
        className: "bg-sky-500/10 text-sky-400 border-sky-500/20",
      };
    case "lrclib":
      return {
        label: "LRCLIB",
        className: "bg-white/10 text-neutral-200 border-white/20",
        href: "https://lrclib.net",
      };
    case "import":
      return {
        label: "Uploaded .lrc file",
        className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      };
    default:
      return {
        label: lyrics.provider || "Custom",
        className: "bg-neutral-800 text-neutral-300 border-neutral-700",
      };
  }
}

function LyricsSession({
  url,
  title,
  lyrics,
  lyricsState,
}: {
  url: string;
  title: string;
  lyrics?: TrackLyricsType;
  lyricsState?: string;
}) {
  const canMutate = useCanMutate();
  const [editing, setEditing] = useState(false);
  const initialQuery = buildLyricsQuery(title);
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const lines = useMemo(() => getLyricsLines(lyrics), [lyrics]);
  const synced = lines.some((line) => line.text);

  const {
    data: records = [],
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["lyrics-search", submittedQuery],
    queryFn: ({ signal }) => searchLyrics(submittedQuery, signal),
    enabled: editing && !!submittedQuery,
    staleTime: 30 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  function selectRecord(record: LyricsRecord) {
    try {
      if (shareLyrics(url, lyricsFromRecord(record))) setEditing(false);
    } catch {
      toast.error("Lyrics exceed 40 KB. Please choose another version or upload a .lrc file.");
    }
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const nextQuery = query.trim();
    if (nextQuery === submittedQuery) void refetch();
    else setSubmittedQuery(nextQuery);
  }

  function adjustOffset(amount: number) {
    if (!lyrics || !canMutate) return;
    shareLyrics(url, { ...lyrics, offset: Number(Math.max(-30, Math.min(30, lyrics.offset + amount)).toFixed(2)) });
  }

  const providerInfo = lyrics ? getProviderInfo(lyrics) : null;

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-neutral-300">
          <Music2 className="size-4 text-primary-400" />
          <span>Lyrics</span>
        </div>
        {canMutate && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)}>
            {editing ? (lyrics ? "Back to lyrics" : "Close search") : "Edit lyrics"}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <form onSubmit={submitSearch} className="flex gap-2">
            <input
              aria-label="Track and artist name"
              className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
              value={query}
              maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Enter track and artist name..."
            />
            <Button type="submit" size="sm" disabled={!query.trim() || isFetching}>
              <Search className="size-4" /> Search
            </Button>
          </form>
          {isFetching && (
            <p role="status" className="flex items-center gap-2 text-sm text-neutral-400">
              <Loader2 className="size-4 animate-spin" /> Searching lyrics…
            </p>
          )}
          {isError && (
            <p role="alert" className="text-sm text-amber-300">
              Unable to search lyrics right now. Try again or upload a .lrc file below.
            </p>
          )}
          {!isFetching && !isError && records.length === 0 && (
            <p className="text-sm text-neutral-400">
              No results found. Try searching with different keywords or import a .lrc file below.
            </p>
          )}
          <div className="space-y-2">
            {records.map((record) => (
              <button
                key={record.id}
                type="button"
                disabled={!canMutate}
                onClick={() => selectRecord(record)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-left hover:border-primary-500 focus-visible:outline-2 focus-visible:outline-primary-400 disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{record.trackName}</span>
                  <span className="block truncate text-xs text-neutral-400">
                    {record.artistName} · {record.albumName} · {formatTime(record.duration)}
                  </span>
                </span>
                <span className={cn("shrink-0 text-xs", record.syncedLyrics ? "text-primary-400" : "text-neutral-400")}>
                  {record.syncedLyrics ? "Synced" : "Plain"}
                </span>
              </button>
            ))}
          </div>
          <LyricsImport url={url} onSaved={() => setEditing(false)} disabled={!canMutate} />
        </div>
      ) : lyrics ? (
        synced ? (
          <TimedLyrics key={lyrics.synced} lines={lines} offset={lyrics.offset} />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-neutral-900/30 p-4 sm:p-8">
            <p className="mb-4 text-xs text-amber-300/80">
              Plain text lyrics (no timestamps). You can edit or upload a .lrc file for auto-scroll.
            </p>
            <p className="whitespace-pre-line text-lg leading-relaxed text-neutral-300">
              {lyrics.plain || "No lyrics available."}
            </p>
          </div>
        )
      ) : lyricsState === "not_found" || lyricsState === "error" ? (
        <div className="min-h-0 flex-1 flex flex-col items-center justify-center gap-4 rounded-xl bg-neutral-900/40 p-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-neutral-800 text-neutral-400 border border-neutral-700/50">
            <Music2 className="size-6 text-neutral-400" />
          </div>
          <div className="space-y-1">
            <p className="text-base font-semibold text-white">
              {lyricsState === "error" ? "Unable to load lyrics" : "No matching lyrics found"}
            </p>
            <p className="text-xs text-neutral-400 max-w-md">
              {lyricsState === "error"
                ? "The system will retry automatically. You can continue listening normally."
                : "No matching lyrics found from YouTube or lyrics database."}
            </p>
          </div>
          {canMutate && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const ws = useGlobalStore.getState().socket;
                if (ws) sendWSRequest({ ws, request: { type: "RETRY_TRACK_LYRICS", audioSource: url } });
              }}
            >
              <RotateCw className="size-4" /> Retry lyrics
            </Button>
          )}
          {canMutate && (
            <Button variant="secondary" size="sm" className="mt-2 gap-1.5" onClick={() => setEditing(true)}>
              <Search className="size-4" /> Search & Edit manually
            </Button>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 flex flex-col items-center justify-center gap-4 rounded-xl bg-neutral-900/40 p-6 text-center">
          <div className="relative flex items-center justify-center">
            <div className="absolute size-14 animate-ping rounded-full bg-primary-500/20" />
            <div className="relative flex size-12 items-center justify-center rounded-full bg-primary-500/10 text-primary-400">
              <Loader2 className="size-6 animate-spin" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-base font-semibold text-white">Fetching lyrics automatically…</p>
            <p className="text-xs text-neutral-400 max-w-md">
              Prioritizing YouTube original subtitles, then searching the lyrics database.
            </p>
          </div>
          {canMutate && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 text-xs border-neutral-700 hover:bg-neutral-800"
              onClick={() => setEditing(true)}
            >
              <Search className="size-3.5 mr-1.5" /> Manual search / Import .lrc
            </Button>
          )}
        </div>
      )}

      {lyrics && !editing && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs text-neutral-400 pt-2 border-t border-neutral-800">
          <div className="flex items-center gap-2">
            {providerInfo && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  providerInfo.className
                )}
              >
                <Sparkles className="size-3" />
                {providerInfo.href ? (
                  <a href={providerInfo.href} target="_blank" rel="noreferrer" className="underline hover:text-white">
                    {providerInfo.label}
                  </a>
                ) : (
                  providerInfo.label
                )}
              </span>
            )}
            {lyrics.language && (
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase text-neutral-300">
                {lyrics.language}
              </span>
            )}
            <span className="text-neutral-500">· Synced room-wide</span>
          </div>
          {synced && (
            <div className="flex items-center gap-1" role="group" aria-label="Adjust lyrics sync offset">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label="Show lyrics 0.1s earlier"
                title="Lyrics delayed: click to show 0.1s earlier"
                disabled={!canMutate || lyrics.offset <= -30}
                onClick={() => adjustOffset(-0.1)}
              >
                <Minus className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 font-mono text-xs"
                aria-label="Reset lyrics sync offset"
                disabled={!canMutate || lyrics.offset === 0}
                onClick={() => adjustOffset(-lyrics.offset)}
              >
                {lyrics.offset > 0 ? "+" : ""}
                {lyrics.offset.toFixed(1)}s
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label="Show lyrics 0.1s later"
                title="Lyrics too fast: click to show 0.1s later"
                disabled={!canMutate || lyrics.offset >= 30}
                onClick={() => adjustOffset(0.1)}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}
      <LyricsPlaybackControls />
    </>
  );
}

function LyricsImport({ url, onSaved, disabled }: { url: string; onSaved: () => void; disabled: boolean }) {
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function readFile(file?: File) {
    if (!file) return;
    if (file.size > MAX_LYRICS_BYTES) {
      toast.error("Please choose a lyrics file under 40 KB.");
      return;
    }
    setReading(true);
    try {
      setText(await file.text());
    } catch {
      toast.error("Cannot read this file. You can paste the lyrics directly into the box below.");
    } finally {
      setReading(false);
    }
  }

  function save() {
    try {
      if (shareLyrics(url, lyricsFromText(text))) onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error && !error.message.startsWith("[") ? error.message : "Lyrics must be under 40 KB."
      );
    }
  }

  return (
    <div className="space-y-2 border-t border-neutral-800 pt-4">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="lyrics-import" className="text-sm font-medium">
          Upload lyrics file (.lrc)
        </label>
        <Button variant="outline" size="sm" disabled={disabled || reading} onClick={() => inputRef.current?.click()}>
          <FileUp className="size-4 mr-1.5" /> Choose .lrc file
        </Button>
        <input
          ref={inputRef}
          aria-label="Upload LRC file"
          type="file"
          accept=".lrc,.txt,text/plain"
          className="hidden"
          onChange={(event) => {
            void readFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      <textarea
        id="lyrics-import"
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={disabled || reading}
        maxLength={MAX_LYRICS_BYTES}
        rows={4}
        className="w-full resize-y rounded-md border border-neutral-700 bg-neutral-900 p-3 font-mono text-xs"
        placeholder={"[00:12.50]First lyric line\n[00:16.00]Second lyric line"}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-neutral-400">Use [mm:ss.xx] timestamps to automatically sync lyrics with music.</p>
        <Button size="sm" disabled={disabled || reading || !text.trim()} onClick={save}>
          Apply lyrics
        </Button>
      </div>
    </div>
  );
}

function TimedLyrics({ lines, offset }: { lines: LrcLine[]; offset: number }) {
  const isPlaying = useGlobalStore((state) => state.isPlaying);
  const currentTime = useGlobalStore((state) => state.currentTime);
  const playbackStartTime = useGlobalStore((state) => state.playbackStartTime);
  const playbackOffset = useGlobalStore((state) => state.playbackOffset);
  const canMutate = useCanMutate();
  const duration = useGlobalStore((state) => state.duration);
  const [playingPosition, setPlayingPosition] = useState(() => useGlobalStore.getState().getCurrentTrackPosition());
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const time = (isPlaying ? playingPosition : currentTime) - offset;
  const index = getCurrentLineIndex({ lines, timeSeconds: time });

  useEffect(() => {
    if (!isPlaying) return;
    let frame: number;
    let previous = Number.NaN;
    const update = () => {
      const position = useGlobalStore.getState().getCurrentTrackPosition();
      // Check on every display frame, but render only when visible text changes.
      if (getLyricFrameKey(lines, previous - offset) !== getLyricFrameKey(lines, position - offset)) {
        setPlayingPosition(position);
        previous = position;
      }
      frame = window.requestAnimationFrame(update);
    };
    frame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frame);
  }, [isPlaying, playbackStartTime, playbackOffset, lines, offset]);

  useEffect(() => {
    const container = scrollRef.current;
    const active = activeRef.current;
    if (!container || !active) return;
    const top =
      active.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      container.clientHeight / 2 +
      active.clientHeight / 2;
    container.scrollTo({
      top: Math.max(0, top),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }, [index]);

  function seek(targetTime: number) {
    if (!canMutate || duration <= 0) return;
    const position = Math.max(0, Math.min(duration, targetTime + offset));
    const state = useGlobalStore.getState();
    if (state.isPlaying) state.broadcastPlay(position);
    else {
      state.broadcastPause(position);
      useGlobalStore.setState({ currentTime: position });
    }
  }

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-neutral-900/30 px-3 py-6 sm:px-8"
      aria-label="Synced lyrics"
    >
      {index < 0 && <p className="mb-4 text-center text-sm text-neutral-500">Lyrics will start with the melody.</p>}
      {lines.map((line, lineIndex) => (
        <button
          key={`${line.time}-${lineIndex}`}
          ref={lineIndex === index ? activeRef : undefined}
          type="button"
          aria-current={lineIndex === index ? "true" : undefined}
          aria-label={`${formatTime(Math.max(0, line.time + offset))}: ${line.text || "Melody"}`}
          disabled={!canMutate || duration <= 0}
          onClick={() => seek(line.time)}
          className={cn(
            "block w-full rounded-lg px-2 py-3 text-center text-lg font-semibold whitespace-pre-line hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-primary-400 sm:text-2xl",
            lineIndex === index
              ? "bg-primary-500/10 text-primary-300"
              : lineIndex < index
                ? "text-neutral-500"
                : "text-neutral-400"
          )}
        >
          {lineIndex === index ? <LyricText line={line} time={time} /> : line.text || "♪"}
        </button>
      ))}
    </div>
  );
}

function LyricText({ line, time }: { line: LrcLine; time: number }) {
  if (!line.words?.length) return line.text || "♪";
  return line.words.map((word, index) => (
    <span
      key={index}
      data-active-word={time >= word.startTime && time < word.endTime ? "true" : undefined}
      className={cn(
        time >= word.startTime ? "text-primary-300" : "text-neutral-400",
        time >= word.startTime && time < word.endTime && "underline decoration-primary-400/50 underline-offset-8"
      )}
    >
      {word.text}
    </span>
  ));
}

function LyricsPlaybackControls() {
  const isPlaying = useGlobalStore((state) => state.isPlaying);
  const duration = useGlobalStore((state) => state.duration);
  const count = useGlobalStore((state) => state.audioSources.length);
  const canMutate = useCanMutate();
  return (
    <div className="flex shrink-0 justify-center gap-3 border-t border-neutral-800 pt-3">
      <Button
        variant="secondary"
        disabled={!canMutate || duration <= 0}
        onClick={() => {
          const state = useGlobalStore.getState();
          if (state.isPlaying) state.broadcastPause();
          else state.broadcastPlay();
        }}
      >
        {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
        {isPlaying ? "Pause" : "Play"}
      </Button>
      <Button
        variant="ghost"
        disabled={!canMutate || count < 2}
        onClick={() => useGlobalStore.getState().skipToNextTrack()}
      >
        <SkipForward className="size-4" /> Next track
      </Button>
    </div>
  );
}
