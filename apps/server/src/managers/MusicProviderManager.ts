import { RawSearchResponseSchema, SearchParamsSchema, StreamResponseSchema, TrackParamsSchema } from "@beatsync/shared";
import { buildYoutubeProxyUrl, parseYoutubeVideoId } from "@/lib/youtube";
import type { z } from "zod";

import * as youtube from "youtube-ext";

interface YoutubeVideo {
  id: string;
  title: string;
  durationSec?: number;
  duration?: { text: string };
  channel?: { name?: string };
  thumbnails?: { url: string }[];
}

export class MusicProviderManager {
  private providerUrl: string | undefined;

  constructor() {
    this.providerUrl = process.env.PROVIDER_URL;
  }

  async search(query: string, offset = 0): Promise<z.infer<typeof RawSearchResponseSchema>> {
    try {
      const { q, offset: validOffset } = SearchParamsSchema.parse({
        q: query,
        offset,
      });

      console.log(`Searching YouTube for query: "${q}"`);

      let results: { videos: YoutubeVideo[] };
      const videoId = parseYoutubeVideoId(q);
      if (videoId) {
        try {
          const info = await youtube.videoInfo(q);
          const durationSeconds = Number(info.duration?.lengthSec ?? 0);
          const m = Math.floor(durationSeconds / 60);
          const s = durationSeconds % 60;
          const durationText = `${m}:${s.toString().padStart(2, "0")}`;

          results = {
            videos: [
              {
                id: info.id,
                title: info.title,
                durationSec: durationSeconds,
                duration: { text: durationText },
                channel: { name: info.channel?.name },
                thumbnails: info.thumbnails,
              },
            ],
          };
        } catch (error) {
          console.warn(`videoInfo failed for URL: ${q}, falling back to search`, error);
          const searchResult = await youtube.search(q);
          results = { videos: searchResult.videos as YoutubeVideo[] };
        }
      } else {
        const searchResult = await youtube.search(q);
        results = { videos: searchResult.videos as YoutubeVideo[] };
      }

      const videosWithDuration = results.videos.map((video) => {
        let durationSec = video.durationSec;
        if (durationSec === undefined && video.duration?.text) {
          const parts = video.duration.text.split(":").map(Number);
          if (parts.length === 2) durationSec = parts[0] * 60 + parts[1];
          else if (parts.length === 3) durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
        return { ...video, durationSec: durationSec ?? 0 };
      });

      const filteredVideos = videosWithDuration.filter((v) => v.durationSec > 0 && v.durationSec <= 360);

      const limit = 10;
      const pagedTracks = filteredVideos.slice(validOffset, validOffset + limit);

      const mockResponse = {
        data: {
          tracks: {
            limit,
            offset: validOffset,
            total: filteredVideos.length,
            items: pagedTracks.map((video) => {
              return {
                id: video.id,
                title: video.title,
                duration: video.durationSec,
                parental_warning: false,
                track_number: 1,
                isrc: null,
                version: null,
                performer: {
                  id: 0,
                  name: video.channel?.name ?? "YouTube User",
                },
                album: {
                  id: "yt_album",
                  title: "YouTube",
                  duration: video.durationSec,
                  parental_warning: false,
                  release_date_original: "Unknown",
                  image: {
                    small: video.thumbnails?.[0]?.url ?? "",
                    thumbnail: video.thumbnails?.[0]?.url ?? "",
                    large: video.thumbnails?.[(video.thumbnails?.length ?? 1) - 1]?.url ?? "",
                    back: null,
                  },
                  artists: [{ id: 0, name: video.channel?.name ?? "YouTube User", roles: ["Main Artist"] }],
                },
              };
            }),
          },
        },
      };

      return RawSearchResponseSchema.parse(mockResponse);
    } catch (error) {
      throw new Error(`Search failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async stream(trackId: number | string) {
    try {
      const { id } = TrackParamsSchema.parse({ id: trackId });

      if (typeof id === "string") {
        console.log(`Preparing YouTube proxy URL for string ID: ${id}`);
        const proxiedUrl = buildYoutubeProxyUrl(id);
        const mockResponse = {
          success: true,
          data: {
            url: proxiedUrl,
          },
        };
        return StreamResponseSchema.parse(mockResponse);
      }

      if (!this.providerUrl) {
        throw new Error(`Track with ID ${id} cannot be streamed because PROVIDER_URL is not set`);
      }

      const streamUrl = new URL("/api/track", this.providerUrl);
      streamUrl.searchParams.set("id", id.toString());

      const response = await fetch(streamUrl.toString());

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: unknown = await response.json();

      return StreamResponseSchema.parse(data);
    } catch (error) {
      throw new Error(`Download failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}

// Export singleton instance
export const MUSIC_PROVIDER_MANAGER = new MusicProviderManager();
