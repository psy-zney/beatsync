import { expect, test, spyOn, mock } from "bun:test";
import { toast } from "sonner";
import { useGlobalStore } from "../../store/global";
import { decodeWSResponse } from "../wsResponse";
import { audioContextManager } from "../audioContextManager";

test("hidden room preload keeps the playlist and selection intact without a notification", () => {
  const original = useGlobalStore.getState();
  const notification = spyOn(toast, "info").mockImplementation(() => "ignored");
  try {
    const buffer = { duration: 60 } as AudioBuffer;
    const sources = ["a", "b", "c"].map((url) => ({ source: { url }, status: "loaded" as const, buffer }));
    useGlobalStore.setState({ audioSources: sources, selectedAudioUrl: "a", socket: null });
    const response = decodeWSResponse(
      JSON.stringify({
        type: "ROOM_EVENT",
        event: {
          type: "PRELOAD_NEXT_AUDIO",
          currentAudioSource: "a",
          nextAudioSource: "c",
          shuffled: true,
        },
      })
    );
    if (response?.type !== "ROOM_EVENT" || response.event.type !== "PRELOAD_NEXT_AUDIO")
      throw new Error("preload packet rejected");
    useGlobalStore.getState().handlePreloadNextAudio(response.event);
    const state = useGlobalStore.getState();
    expect(state.audioSources).toBe(sources);
    expect(state.selectedAudioUrl).toBe("a");
    expect(state.plannedNextAudioUrl).toBe("c");
    expect(state.isShuffled).toBe(true);
    expect(notification).not.toHaveBeenCalled();
  } finally {
    useGlobalStore.setState(original, true);
    notification.mockRestore();
  }
});

test("downloads the shared shuffle choice early and uses that same choice when continuing", async () => {
  const original = useGlobalStore.getState();
  const buffer = { duration: 60 } as AudioBuffer;
  const fetchAudio = spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
  const decode = spyOn(audioContextManager, "decodeAudioData").mockResolvedValue(buffer);
  const info = spyOn(toast, "info").mockImplementation(() => "ignored");
  const warning = spyOn(toast, "warning").mockImplementation(() => "ignored");
  const error = spyOn(toast, "error").mockImplementation(() => "ignored");
  const send = mock<(message: string) => void>(() => {});
  const urls = ["a", "b", "c", "d", "e"].map((name) => `https://audio.test/${name}.mp3`);
  let unsubscribe = () => {};
  try {
    useGlobalStore.setState({
      audioSources: urls.map((url, index) =>
        index < 3
          ? { source: { url }, status: "loaded" as const, buffer }
          : { source: { url }, status: "idle" as const }
      ),
      selectedAudioUrl: urls[0],
      bufferAccessQueue: urls.slice(0, 3),
      socket: { readyState: WebSocket.OPEN, send } as unknown as WebSocket,
      isPlaying: true,
      audioPlayer: null,
      awaitingSyncAfterLoadUrl: null,
    });
    useGlobalStore.getState().handlePreloadNextAudio({
      type: "PRELOAD_NEXT_AUDIO",
      currentAudioSource: urls[0],
      nextAudioSource: urls[4],
      shuffled: true,
    });
    expect(useGlobalStore.getState().selectedAudioUrl).toBe(urls[0]);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("planned successor did not finish loading")), 1000);
      unsubscribe = useGlobalStore.subscribe((state) => {
        if (state.audioSources.find((item) => item.source.url === urls[4])?.status === "loaded") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    expect(fetchAudio).toHaveBeenCalledTimes(1);
    expect(fetchAudio.mock.calls[0][0]).toBe(urls[4]);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(useGlobalStore.getState().audioSources.map((item) => item.source.url)).toEqual(urls);
    useGlobalStore.getState().skipToNextTrack(true);
    const requests = send.mock.calls.map(([message]) => JSON.parse(message));
    expect(requests.find((request) => request.type === "PLAY")).toEqual({
      type: "PLAY",
      audioSource: urls[4],
      previousAudioSource: urls[0],
      trackTimeSeconds: 0,
    });
    expect(fetchAudio).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
    useGlobalStore.setState(original, true);
    fetchAudio.mockRestore();
    decode.mockRestore();
    info.mockRestore();
    warning.mockRestore();
    error.mockRestore();
  }
});
