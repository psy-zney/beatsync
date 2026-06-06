import { RawSearchResponseSchema, SearchParamsSchema, StreamResponseSchema, TrackParamsSchema } from "@beatsync/shared";
import { buildYoutubeProxyUrl } from "@/lib/youtube";
import type { z } from "zod";

import * as youtube from "youtube-ext";

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
      const results = await youtube.search(q);

      const limit = 10;
      const pagedTracks = results.videos.slice(validOffset, validOffset + limit);

      const mockResponse = {
        data: {
          tracks: {
            limit,
            offset: validOffset,
            total: results.videos.length,
            items: pagedTracks.map((video) => {
              // Parse duration
              let durationSec = 0;
              if (video.duration?.text) {
                const parts = video.duration.text.split(":").map(Number);
                if (parts.length === 2) durationSec = parts[0] * 60 + parts[1];
                else if (parts.length === 3) durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
              }

              return {
                id: video.id,
                title: video.title,
                duration: durationSec,
                parental_warning: false,
                track_number: 1,
                isrc: null,
                version: null,
                performer: {
                  id: 0,
                  name: video.channel?.name || "YouTube User",
                },
                album: {
                  id: "yt_album",
                  title: "YouTube",
                  duration: durationSec,
                  parental_warning: false,
                  release_date_original: "Unknown",
                  image: {
                    small: video.thumbnails?.[0]?.url || "",
                    thumbnail: video.thumbnails?.[0]?.url || "",
                    large: video.thumbnails?.[video.thumbnails.length - 1]?.url || "",
                    back: null,
                  },
                  artists: [{ id: 0, name: video.channel?.name || "YouTube User", roles: ["Main Artist"] }],
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
        throw new Error(
          `Track with ID ${id} cannot be streamed because PROVIDER_URL is not set and it's not a YouTube ID`
        );
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
