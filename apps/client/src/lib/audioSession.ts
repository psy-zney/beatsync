type WebAudioSessionType = "playback" | "play-and-record";

type NavigatorWithAudioSession = Navigator & {
  audioSession?: { type: WebAudioSessionType };
};

/** Safari blocks microphone capture while its audio session is playback-only. */
export const setWebAudioSessionType = (type: WebAudioSessionType) => {
  if (typeof navigator === "undefined") return;
  try {
    const session = (navigator as NavigatorWithAudioSession).audioSession;
    if (session && session.type !== type) session.type = type;
  } catch (error) {
    console.warn("Could not change the browser audio session", error);
  }
};
