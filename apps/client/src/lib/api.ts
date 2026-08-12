import {
  DiscoverRoomsType,
  GetActiveRoomsType,
  GetDefaultAudioType,
  GetUploadUrlType,
  UploadCompleteResponseType,
  UploadCompleteType,
  UploadUrlResponseType,
} from "@beatsync/shared";
import axios from "axios";
import { getApiUrl } from "./urls";

const baseAxios = axios.create({
  get baseURL() {
    return getApiUrl();
  },
});

const audioContentType = (file: File) => {
  if (file.type.startsWith("audio/") || file.type === "video/webm") return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return (
    {
      mp3: "audio/mpeg",
      wav: "audio/wav",
      m4a: "audio/mp4",
      aac: "audio/aac",
      ogg: "audio/ogg",
      webm: "audio/webm",
      flac: "audio/flac",
    }[extension ?? ""] ?? "audio/mpeg"
  );
};

export const uploadAudioFile = async (data: { file: File; roomId: string }) => {
  try {
    // Safari on iOS can return an empty or generic MIME type for files picked
    // from iCloud Drive. Infer it from the extension so the signed PUT and the
    // backend validation use a stable audio Content-Type.
    const contentType = audioContentType(data.file);
    // Step 1: Get presigned upload URL from server
    const uploadUrlRequest: GetUploadUrlType = {
      roomId: data.roomId,
      fileName: data.file.name,
      contentType,
    };

    const presignedURLResponse = await baseAxios.post<UploadUrlResponseType>(
      "/upload/get-presigned-url",
      uploadUrlRequest
    );

    const { uploadUrl, publicUrl } = presignedURLResponse.data;

    // Step 2: Upload directly to R2 using presigned URL
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      body: data.file,
      headers: {
        "Content-Type": contentType,
      },
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${uploadResponse.statusText}`);
    }

    // Step 3: Notify server that upload completed successfully
    const uploadCompleteRequest: UploadCompleteType = {
      roomId: data.roomId,
      originalName: data.file.name,
      publicUrl,
    };

    await baseAxios.post<UploadCompleteResponseType>("/upload/complete", uploadCompleteRequest);

    return {
      success: true,
      publicUrl,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.message || "Failed to upload audio file");
    }
    throw error;
  }
};

export const uploadYoutubeLink = async (data: { url: string; roomId: string }) => {
  try {
    const response = await baseAxios.post("/upload/youtube", data);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.message || "Failed to process YouTube link");
    }
    throw error;
  }
};

export const fetchAudio = async (url: string) => {
  try {
    // Direct fetch from R2 public URL - zero server bandwidth
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.statusText}`);
    }

    return await response.blob();
  } catch (error) {
    throw new Error(`Failed to fetch audio: ${error}`);
  }
};

export async function fetchDefaultAudioSources() {
  try {
    const response = await fetch(`${getApiUrl()}/default`);

    if (!response.ok) {
      console.error("Failed to fetch default audio sources:", response.status);
      return [];
    }

    const files: GetDefaultAudioType = await response.json();
    return files;
  } catch (error) {
    console.error("Error fetching default audio sources:", error);
    return [];
  }
}

export async function fetchActiveRooms() {
  const response = await fetch(`${getApiUrl()}/active-rooms`);
  const data: GetActiveRoomsType = await response.json();
  return data;
}

export async function fetchDiscoverRooms() {
  const response = await fetch(`${getApiUrl()}/discover`);
  const data: DiscoverRoomsType = await response.json();
  return data;
}

export interface VoiceTokenResponse {
  serverUrl: string;
  participantToken: string;
}

export async function fetchVoiceToken(data: {
  roomId: string;
  clientId: string;
  username: string;
}): Promise<VoiceTokenResponse> {
  const response = await baseAxios.post<VoiceTokenResponse>("/voice/token", data);
  return response.data;
}

export interface SpotifyResolveResponse {
  success: boolean;
  data: {
    title: string;
    type: "playlist" | "album" | "track";
    coverUrl?: string;
    tracks: Array<{
      title: string;
      artist: string;
      album?: string;
      coverUrl?: string;
      durationMs?: number;
    }>;
  };
}

export async function resolveSpotifyPlaylist(url: string, maxTracks = 500): Promise<SpotifyResolveResponse> {
  const response = await baseAxios.post<SpotifyResolveResponse>("/spotify/resolve", { url, maxTracks });
  return response.data;
}
