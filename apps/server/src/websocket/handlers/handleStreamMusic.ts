import { IS_DEMO_MODE } from "@/demo";
import { generateAudioFileName, uploadBytes, uploadBytesToKey } from "@/lib/r2";
import { isYoutubeProxyUrl, getYoutubeStreamByVideoId } from "@/lib/youtube";
import { globalManager } from "@/managers";
import { MUSIC_PROVIDER_MANAGER } from "@/managers/MusicProviderManager";
import { sendBroadcast } from "@/utils/responses";
import type { HandlerFunction } from "@/websocket/types";
import type { ExtractWSRequestFrom } from "@beatsync/shared";

export const handleStreamMusic: HandlerFunction<ExtractWSRequestFrom["STREAM_MUSIC"]> = async ({
  ws,
  message,
  server,
}) => {
  if (IS_DEMO_MODE) return;
  const roomId = ws.data.roomId;

  // Require room to exist before processing stream request
  const room = globalManager.getRoom(roomId);
  if (!room) {
    console.error(`Stream request failed: Room ${roomId} not found`);
    return;
  }

  // Check if this track is already being streamed
  const trackId = message.trackId.toString();
  if (room.hasActiveStreamJob(trackId)) {
    console.log(`Track ${trackId} is already being streamed for room ${roomId}, ignoring duplicate request`);
    return;
  }

  // Add job to room and broadcast updated count
  room.addStreamJob(trackId);
  sendBroadcast({
    server,
    roomId,
    message: {
      type: "STREAM_JOB_UPDATE",
      activeJobCount: room.getActiveStreamJobCount(),
    },
  });

  try {
    // Get the stream URL from the music provider
    const streamResponse = await MUSIC_PROVIDER_MANAGER.stream(message.trackId);

    if (!streamResponse.success) {
      throw new Error("Failed to get stream URL");
    }

    const streamUrl = streamResponse.data.url;

    // Use provided track name or fallback to track ID
    const originalName = message.trackName ?? `track-${message.trackId}`;

    if (isYoutubeProxyUrl(streamUrl)) {
      const videoId = new URL(streamUrl, "http://localhost").searchParams.get("videoId");
      if (!videoId) {
        throw new Error("Invalid YouTube proxy URL: videoId is missing");
      }

      console.log(`Resolving real YouTube stream URL for videoId: ${videoId}`);
      const resolved = await getYoutubeStreamByVideoId(videoId);
      console.log(`Downloading YouTube audio stream from resolved URL: ${resolved.streamUrl}`);

      const youtubeResponse = await fetch(resolved.streamUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Range: "bytes=0-", // Forces YouTube to bypass 1x streaming throttle
        },
      });

      if (!youtubeResponse.ok) {
        throw new Error(
          `Failed to download YouTube audio stream: ${youtubeResponse.status} ${youtubeResponse.statusText}`
        );
      }

      const contentType = youtubeResponse.headers.get("content-type") ?? "audio/webm";
      const extension = contentType.includes("webm") ? "webm" : contentType.includes("mp4") ? "m4a" : "mp3";
      const key = `youtube-cache/${videoId}.${extension}`;

      console.log(`Uploading YouTube track to global R2 cache: ${key}`);
      const arrayBuffer = await youtubeResponse.arrayBuffer();
      const r2Url = await uploadBytesToKey(arrayBuffer, key, contentType);

      const sources = room.addAudioSource({ url: r2Url, title: originalName });

      console.log(`Successfully uploaded YouTube track to R2: ${r2Url}`);
      console.log(`Broadcasting new audio sources to room ${roomId}: ${sources.length} total sources`);

      sendBroadcast({
        server,
        roomId,
        message: {
          type: "ROOM_EVENT",
          event: {
            type: "SET_AUDIO_SOURCES",
            sources,
          },
        },
      });
      return;
    }

    // Download the audio file
    console.log(`Downloading audio from: ${streamUrl}`);
    const response = await fetch(streamUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    // Generate a unique filename for R2
    const fileName = generateAudioFileName(`${originalName}.mp3`);

    if (!response.ok) {
      throw new Error(`Failed to download audio: ${response.status}`);
    }

    // Get audio bytes
    const arrayBuffer = await response.arrayBuffer();

    // Get content type from response headers, fallback to audio/mpeg
    const contentType = response.headers.get("content-type") ?? "audio/mpeg";

    // Upload directly to R2
    console.log(`Uploading to R2: room-${roomId}/${fileName}`);
    const r2Url = await uploadBytes(arrayBuffer, roomId, fileName, contentType);

    // Add the audio source to the room and get updated sources list
    const sources = room.addAudioSource({ url: r2Url, title: originalName });

    console.log(`Successfully uploaded track to R2: ${r2Url}`);
    console.log(`Broadcasting new audio sources to room ${roomId}: ${sources.length} total sources`);

    // Broadcast to all room members that new audio is available
    sendBroadcast({
      server,
      roomId,
      message: {
        type: "ROOM_EVENT",
        event: {
          type: "SET_AUDIO_SOURCES",
          sources,
        },
      },
    });
  } catch (error) {
    console.error("Error in handleStreamMusic:", error);
  } finally {
    // Job completed or failed - remove from tracking and notify clients
    room.removeStreamJob(trackId);
    sendBroadcast({
      server,
      roomId,
      message: {
        type: "STREAM_JOB_UPDATE",
        activeJobCount: room.getActiveStreamJobCount(),
      },
    });
  }
};
