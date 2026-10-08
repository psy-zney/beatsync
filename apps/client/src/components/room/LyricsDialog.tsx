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
  Mic2,
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

type LyricsMode = "lyrics" | "karaoke";

function shareLyrics(url: string, lyrics: TrackLyricsType | null, onlyIfEmpty = false): boolean {
  if (lyrics && !onlyIfEmpty) lyrics = { ...lyrics, automatic: false, resolverVersion: 5 };
  const ws = useGlobalStore.getState().socket;
  if (!ws || !sendWSRequest({ ws, request: { type: "SET_TRACK_LYRICS", audioSource: url, lyrics, onlyIfEmpty } })) {
    if (!onlyIfEmpty) toast.error("Kết nối lại phòng trước khi chỉnh sửa lời.");
    return false;
  }
  return true;
}

export function LyricsControls() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<LyricsMode>("lyrics");
  const url = useGlobalStore((state) => state.selectedAudioUrl);
  const source = useGlobalStore((state) => state.audioSources.find((track) => track.source.url === url)?.source);
  const title = source?.title || (url ? extractFileNameFromUrl(url) : "Chọn một bài hát");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="mt-2 flex justify-center gap-2">
        <DialogTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs text-neutral-400 hover:text-white"
            disabled={!source}
            onClick={() => setMode("lyrics")}
          >
            <Music2 className="size-3.5" /> Lời bài hát
          </Button>
        </DialogTrigger>
        <DialogTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs text-neutral-400 hover:text-white"
            disabled={!source}
            onClick={() => setMode("karaoke")}
          >
            <Mic2 className="size-3.5" /> Karaoke
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent
        className={cn(
          "flex h-[min(42rem,85dvh)] flex-col overflow-hidden border-neutral-800 bg-neutral-950 p-4 text-white sm:max-w-3xl sm:p-6",
          mode === "karaoke" &&
            "h-dvh max-h-dvh w-screen max-w-none rounded-none border-0 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:max-w-none"
        )}
      >
        <div className="shrink-0 pr-8">
          <DialogTitle className="truncate leading-normal">{title}</DialogTitle>
          <DialogDescription>Lời bài hát và karaoke tự động đồng bộ theo tiến trình phát của phòng.</DialogDescription>
        </div>
        {source ? (
          <LyricsSession
            key={url}
            url={url}
            title={title}
            lyrics={source.lyrics}
            lyricsState={source.lyricsState}
            mode={mode}
            setMode={setMode}
          />
        ) : (
          <p className="my-auto text-center text-neutral-400">Chọn một bài trong danh sách để xem lời bài hát.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function getProviderInfo(lyrics: TrackLyricsType) {
  switch (lyrics.provider) {
    case "youtube-manual":
      return {
        label: "Phụ đề YouTube (Tác giả)",
        className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      };
    case "youtube-auto":
      return {
        label: "Phụ đề YouTube (Tự động)",
        className: "bg-sky-500/10 text-sky-400 border-sky-500/20",
      };
    case "lrclib":
      return {
        label: "LRCLIB",
        className: "bg-violet-500/10 text-violet-400 border-violet-500/20",
        href: "https://lrclib.net",
      };
    case "import":
      return {
        label: "File .lrc tải lên",
        className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      };
    default:
      return {
        label: lyrics.provider || "Chỉnh tay",
        className: "bg-neutral-800 text-neutral-300 border-neutral-700",
      };
  }
}

function LyricsSession({
  url,
  title,
  lyrics,
  lyricsState,
  mode,
  setMode,
}: {
  url: string;
  title: string;
  lyrics?: TrackLyricsType;
  lyricsState?: string;
  mode: LyricsMode;
  setMode: (mode: LyricsMode) => void;
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
      toast.error("Lời bài hát này vượt quá 40 KB. Vui lòng chọn bản khác hoặc tải file .lrc lên.");
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
        <div className="flex gap-1" role="group" aria-label="Chế độ hiển thị lời">
          <Button
            size="sm"
            variant={mode === "lyrics" ? "secondary" : "ghost"}
            aria-pressed={mode === "lyrics"}
            onClick={() => setMode("lyrics")}
          >
            <Music2 className="size-4" /> Lời bài hát
          </Button>
          <Button
            size="sm"
            variant={mode === "karaoke" ? "secondary" : "ghost"}
            aria-pressed={mode === "karaoke"}
            onClick={() => setMode("karaoke")}
          >
            <Mic2 className="size-4" /> Karaoke
          </Button>
        </div>
        {canMutate && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)}>
            {editing ? (lyrics ? "Quay lại lời bài hát" : "Đóng tìm kiếm") : "Sửa lời"}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <form onSubmit={submitSearch} className="flex gap-2">
            <input
              aria-label="Tên bài hát và ca sĩ"
              className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
              value={query}
              maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nhập tên bài hát và ca sĩ..."
            />
            <Button type="submit" size="sm" disabled={!query.trim() || isFetching}>
              <Search className="size-4" /> Tìm kiếm
            </Button>
          </form>
          {isFetching && (
            <p role="status" className="flex items-center gap-2 text-sm text-neutral-400">
              <Loader2 className="size-4 animate-spin" /> Đang tìm kiếm lời bài hát…
            </p>
          )}
          {isError && (
            <p role="alert" className="text-sm text-amber-300">
              Không thể tìm kiếm lời lúc này. Bạn có thể thử lại hoặc tải file .lrc lên bên dưới.
            </p>
          )}
          {!isFetching && !isError && records.length === 0 && (
            <p className="text-sm text-neutral-400">
              Chưa tìm thấy kết quả. Thử tìm với từ khóa khác hoặc nhập file .lrc bên dưới.
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
                  {record.syncedLyrics ? "Khớp thời gian" : "Lời thường"}
                </span>
              </button>
            ))}
          </div>
          <LyricsImport url={url} onSaved={() => setEditing(false)} disabled={!canMutate} />
        </div>
      ) : lyrics ? (
        synced ? (
          <TimedLyrics key={lyrics.synced} lines={lines} offset={lyrics.offset} mode={mode} />
        ) : mode === "karaoke" ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto rounded-2xl bg-gradient-to-b from-primary-950/20 to-neutral-900/40 p-6 text-center sm:p-10">
            <div className="flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">
              <span>Lời tĩnh (Chưa có timestamp theo thời gian)</span>
            </div>
            <div className="max-h-[60vh] max-w-4xl overflow-y-auto px-4">
              <p className="whitespace-pre-line text-xl font-medium leading-relaxed text-neutral-200 sm:text-2xl sm:leading-loose">
                {lyrics.plain || "Không có nội dung lời bài hát."}
              </p>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-neutral-900/30 p-4 sm:p-8">
            <p className="mb-4 text-xs text-amber-300/80">
              Lời bài hát dạng văn bản (chưa có timestamp). Có thể chỉnh sửa hoặc tải file .lrc lên để chạy chữ tự động.
            </p>
            <p className="whitespace-pre-line text-lg leading-relaxed text-neutral-300">
              {lyrics.plain || "Không có nội dung lời bài hát."}
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
              {lyricsState === "error" ? "Tạm thời chưa lấy được lời" : "Chưa tìm được lời phù hợp"}
            </p>
            <p className="text-xs text-neutral-400 max-w-md">
              {lyricsState === "error"
                ? "Hệ thống sẽ tự thử lại. Bạn vẫn có thể nghe nhạc bình thường."
                : "Chưa có lời khớp bài hát và ngôn ngữ gốc từ YouTube hoặc kho lời."}
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
              <RotateCw className="size-4" /> Thử lấy lời lại
            </Button>
          )}
          {canMutate && (
            <Button variant="secondary" size="sm" className="mt-2 gap-1.5" onClick={() => setEditing(true)}>
              <Search className="size-4" /> Tìm kiếm & Sửa lời thủ công
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
            <p className="text-base font-semibold text-white">Đang tự động lấy lời bài hát…</p>
            <p className="text-xs text-neutral-400 max-w-md">
              Ưu tiên lời gốc từ YouTube, sau đó tìm bản phù hợp trong kho lời.
            </p>
          </div>
          {canMutate && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 text-xs border-neutral-700 hover:bg-neutral-800"
              onClick={() => setEditing(true)}
            >
              <Search className="size-3.5 mr-1.5" /> Tìm kiếm thủ công / Nhập .lrc
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
            <span className="text-neutral-500">· Đồng bộ cả phòng</span>
          </div>
          {synced && (
            <div className="flex items-center gap-1" role="group" aria-label="Hiệu chỉnh độ trễ lời">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label="Hiển thị lời sớm hơn 0.1 giây"
                title="Lời đang chậm: bấm để hiện sớm hơn 0.1 giây"
                disabled={!canMutate || lyrics.offset <= -30}
                onClick={() => adjustOffset(-0.1)}
              >
                <Minus className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 font-mono text-xs"
                aria-label="Đặt lại thời gian lời"
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
                aria-label="Hiển thị lời muộn hơn 0.1 giây"
                title="Lời đang nhanh: bấm để hiện muộn hơn 0.1 giây"
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
      toast.error("Vui lòng chọn file lời bài hát dưới 40 KB.");
      return;
    }
    setReading(true);
    try {
      setText(await file.text());
    } catch {
      toast.error("Không thể đọc file này. Bạn có thể dán nội dung lời trực tiếp vào ô bên dưới.");
    } finally {
      setReading(false);
    }
  }

  function save() {
    try {
      if (shareLyrics(url, lyricsFromText(text))) onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error && !error.message.startsWith("[") ? error.message : "Lời bài hát phải nhỏ hơn 40 KB."
      );
    }
  }

  return (
    <div className="space-y-2 border-t border-neutral-800 pt-4">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="lyrics-import" className="text-sm font-medium">
          Tải lên file lời bài hát (.lrc)
        </label>
        <Button variant="outline" size="sm" disabled={disabled || reading} onClick={() => inputRef.current?.click()}>
          <FileUp className="size-4 mr-1.5" /> Chọn file .lrc
        </Button>
        <input
          ref={inputRef}
          aria-label="Tải lên file LRC"
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
        placeholder={"[00:12.50]Câu hát đầu tiên\n[00:16.00]Câu hát tiếp theo"}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-neutral-400">Dùng mốc thời gian [mm:ss.xx] để lời chạy tự động theo nhạc.</p>
        <Button size="sm" disabled={disabled || reading || !text.trim()} onClick={save}>
          Áp dụng lời bài hát
        </Button>
      </div>
    </div>
  );
}

function TimedLyrics({ lines, offset, mode }: { lines: LrcLine[]; offset: number; mode: LyricsMode }) {
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
  const current = lines[index];
  const next = index >= 0 ? lines[index + 1] : lines.find((line) => line.time > time);

  useEffect(() => {
    if (!isPlaying) return;
    let frame: number;
    let previous = Number.NaN;
    const update = () => {
      const position = useGlobalStore.getState().getCurrentTrackPosition();
      // Check on every display frame, but render only when visible text or the
      // karaoke clock changes. Long playlists do not need 60 React renders/sec.
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
  }, [index, mode]);

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

  if (mode === "karaoke") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto rounded-2xl bg-gradient-to-b from-primary-950/30 to-neutral-900/20 p-4 text-center sm:gap-10 sm:p-10">
        <p className="text-xs uppercase tracking-widest text-neutral-500">
          {time < (lines[0]?.time ?? 0) ? "Chuẩn bị vào bài" : current?.text ? "Hát cùng BeatSync" : "Đoạn dạo nhạc ♪"}
        </p>
        <p
          aria-live="off"
          className="max-w-5xl whitespace-pre-line text-3xl font-bold leading-snug text-primary-300 sm:text-5xl lg:text-6xl"
        >
          {current ? <LyricText line={current} time={time} /> : "♪"}
        </p>
        {next?.text && (
          <p className="max-w-4xl whitespace-pre-line text-xl leading-snug text-neutral-400 sm:text-3xl lg:text-4xl">
            {next.text}
          </p>
        )}
        <span className="font-mono text-xs text-neutral-500">
          {formatTime(Math.max(0, time + offset))} / {formatTime(duration)}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-neutral-900/30 px-3 py-6 sm:px-8"
      aria-label="Lời bài hát đồng bộ"
    >
      {index < 0 && <p className="mb-4 text-center text-sm text-neutral-500">Lời bài hát sẽ bắt đầu cùng giai điệu.</p>}
      {lines.map((line, lineIndex) => (
        <button
          key={`${line.time}-${lineIndex}`}
          ref={lineIndex === index ? activeRef : undefined}
          type="button"
          aria-current={lineIndex === index ? "true" : undefined}
          aria-label={`${formatTime(Math.max(0, line.time + offset))}: ${line.text || "Giai điệu"}`}
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
        {isPlaying ? "Tạm dừng" : "Phát nhạc"}
      </Button>
      <Button
        variant="ghost"
        disabled={!canMutate || count < 2}
        onClick={() => useGlobalStore.getState().skipToNextTrack()}
      >
        <SkipForward className="size-4" /> Bài tiếp theo
      </Button>
    </div>
  );
}
