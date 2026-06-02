import { RawSearchResponseSchema, SearchParamsSchema, StreamResponseSchema, TrackParamsSchema } from "@beatsync/shared";
import { buildYoutubeProxyUrl, getYoutubeMetadata } from "@/lib/youtube";
import type { z } from "zod";

interface MockTrack {
  id: number;
  title: string;
  duration: number;
  parental_warning: boolean;
  track_number: number;
  isrc: string | null;
  version: string | null;
  performer: {
    id: number;
    name: string;
  };
  album: {
    id: string;
    title: string;
    duration: number;
    parental_warning: boolean;
    release_date_original: string;
    image: {
      small: string;
      thumbnail: string;
      large: string;
      back: string | null;
    };
    artists: {
      id: number;
      name: string;
      roles: string[];
    }[];
  };
  youtubeUrl: string;
}

const MOCK_TRACKS: MockTrack[] = [
  {
    id: 10001,
    title: "Never Gonna Give You Up",
    duration: 212,
    parental_warning: false,
    track_number: 1,
    isrc: null,
    version: null,
    performer: { id: 101, name: "Rick Astley" },
    album: {
      id: "album_1",
      title: "Whenever You Need Somebody",
      duration: 212,
      parental_warning: false,
      release_date_original: "1987-11-16",
      image: {
        small: "https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg",
        thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        large: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
        back: null,
      },
      artists: [{ id: 101, name: "Rick Astley", roles: ["Main Artist"] }],
    },
    youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  },
  {
    id: 10002,
    title: "1 A.M Study Session",
    duration: 240,
    parental_warning: false,
    track_number: 1,
    isrc: null,
    version: "Lofi Chill Beats",
    performer: { id: 102, name: "Lofi Girl" },
    album: {
      id: "album_2",
      title: "Lofi Study Beats",
      duration: 240,
      parental_warning: false,
      release_date_original: "2020-01-01",
      image: {
        small: "https://i.ytimg.com/vi/5qap5aO4i9A/default.jpg",
        thumbnail: "https://i.ytimg.com/vi/5qap5aO4i9A/hqdefault.jpg",
        large: "https://i.ytimg.com/vi/5qap5aO4i9A/maxresdefault.jpg",
        back: null,
      },
      artists: [{ id: 102, name: "Lofi Girl", roles: ["Main Artist"] }],
    },
    youtubeUrl: "https://www.youtube.com/watch?v=5qap5aO4i9A",
  },
  {
    id: 10003,
    title: "Faded",
    duration: 212,
    parental_warning: false,
    track_number: 1,
    isrc: null,
    version: null,
    performer: { id: 103, name: "Alan Walker" },
    album: {
      id: "album_3",
      title: "Faded Single",
      duration: 212,
      parental_warning: false,
      release_date_original: "2015-12-03",
      image: {
        small: "https://i.ytimg.com/vi/60ItHLz5WEA/default.jpg",
        thumbnail: "https://i.ytimg.com/vi/60ItHLz5WEA/hqdefault.jpg",
        large: "https://i.ytimg.com/vi/60ItHLz5WEA/maxresdefault.jpg",
        back: null,
      },
      artists: [{ id: 103, name: "Alan Walker", roles: ["Main Artist"] }],
    },
    youtubeUrl: "https://www.youtube.com/watch?v=60ItHLz5WEA",
  },
  {
    id: 10004,
    title: "Sugar",
    duration: 301,
    parental_warning: false,
    track_number: 1,
    isrc: null,
    version: null,
    performer: { id: 104, name: "Maroon 5" },
    album: {
      id: "album_4",
      title: "V",
      duration: 301,
      parental_warning: false,
      release_date_original: "2014-08-29",
      image: {
        small: "https://i.ytimg.com/vi/09R8_2nJtjg/default.jpg",
        thumbnail: "https://i.ytimg.com/vi/09R8_2nJtjg/hqdefault.jpg",
        large: "https://i.ytimg.com/vi/09R8_2nJtjg/maxresdefault.jpg",
        back: null,
      },
      artists: [{ id: 104, name: "Maroon 5", roles: ["Main Artist"] }],
    },
    youtubeUrl: "https://www.youtube.com/watch?v=09R8_2nJtjg",
  },
  {
    id: 10005,
    title: "Uptown Funk",
    duration: 270,
    parental_warning: false,
    track_number: 1,
    isrc: null,
    version: null,
    performer: { id: 105, name: "Bruno Mars ft. Mark Ronson" },
    album: {
      id: "album_5",
      title: "Uptown Special",
      duration: 270,
      parental_warning: false,
      release_date_original: "2014-11-10",
      image: {
        small: "https://i.ytimg.com/vi/OPf0YbXqDm0/default.jpg",
        thumbnail: "https://i.ytimg.com/vi/OPf0YbXqDm0/hqdefault.jpg",
        large: "https://i.ytimg.com/vi/OPf0YbXqDm0/maxresdefault.jpg",
        back: null,
      },
      artists: [{ id: 105, name: "Bruno Mars ft. Mark Ronson", roles: ["Main Artist"] }],
    },
    youtubeUrl: "https://www.youtube.com/watch?v=OPf0YbXqDm0",
  },
  {
    id: 10006,
    title: "Shape of You",
    duration: 263,
    parental_warning: false,
    track_number: 1,
    isrc: null,
    version: null,
    performer: { id: 106, name: "Ed Sheeran" },
    album: {
      id: "album_6",
      title: "÷ (Divide)",
      duration: 263,
      parental_warning: false,
      release_date_original: "2017-03-03",
      image: {
        small: "https://i.ytimg.com/vi/JGwWNGJdvx8/default.jpg",
        thumbnail: "https://i.ytimg.com/vi/JGwWNGJdvx8/hqdefault.jpg",
        large: "https://i.ytimg.com/vi/JGwWNGJdvx8/maxresdefault.jpg",
        back: null,
      },
      artists: [{ id: 106, name: "Ed Sheeran", roles: ["Main Artist"] }],
    },
    youtubeUrl: "https://www.youtube.com/watch?v=JGwWNGJdvx8",
  },
  {
    id: 10007,
    title: "Despacito",
    duration: 281,
    parental_warning: false,
    track_number: 1,
    isrc: null,
    version: null,
    performer: { id: 107, name: "Luis Fonsi ft. Daddy Yankee" },
    album: {
      id: "album_7",
      title: "Vida",
      duration: 281,
      parental_warning: false,
      release_date_original: "2019-02-01",
      image: {
        small: "https://i.ytimg.com/vi/kJQP7kiw5Fk/default.jpg",
        thumbnail: "https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg",
        large: "https://i.ytimg.com/vi/kJQP7kiw5Fk/maxresdefault.jpg",
        back: null,
      },
      artists: [{ id: 107, name: "Luis Fonsi ft. Daddy Yankee", roles: ["Main Artist"] }],
    },
    youtubeUrl: "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
  },
  {
    id: 10008,
    title: "Hello",
    duration: 367,
    parental_warning: false,
    track_number: 1,
    isrc: null,
    version: null,
    performer: { id: 108, name: "Adele" },
    album: {
      id: "album_8",
      title: "25",
      duration: 367,
      parental_warning: false,
      release_date_original: "2015-11-20",
      image: {
        small: "https://i.ytimg.com/vi/YQHsXMglC9A/default.jpg",
        thumbnail: "https://i.ytimg.com/vi/YQHsXMglC9A/hqdefault.jpg",
        large: "https://i.ytimg.com/vi/YQHsXMglC9A/maxresdefault.jpg",
        back: null,
      },
      artists: [{ id: 108, name: "Adele", roles: ["Main Artist"] }],
    },
    youtubeUrl: "https://www.youtube.com/watch?v=YQHsXMglC9A",
  },
  {
    id: 10009,
    title: "See You Again",
    duration: 237,
    parental_warning: false,
    track_number: 1,
    isrc: null,
    version: null,
    performer: { id: 109, name: "Wiz Khalifa ft. Charlie Puth" },
    album: {
      id: "album_9",
      title: "Furious 7 Soundtrack",
      duration: 237,
      parental_warning: false,
      release_date_original: "2015-03-10",
      image: {
        small: "https://i.ytimg.com/vi/RgKAFK5djSk/default.jpg",
        thumbnail: "https://i.ytimg.com/vi/RgKAFK5djSk/hqdefault.jpg",
        large: "https://i.ytimg.com/vi/RgKAFK5djSk/maxresdefault.jpg",
        back: null,
      },
      artists: [{ id: 109, name: "Wiz Khalifa ft. Charlie Puth", roles: ["Main Artist"] }],
    },
    youtubeUrl: "https://www.youtube.com/watch?v=RgKAFK5djSk",
  },
  {
    id: 10010,
    title: "Gangnam Style",
    duration: 252,
    parental_warning: false,
    track_number: 1,
    isrc: null,
    version: null,
    performer: { id: 110, name: "Psy" },
    album: {
      id: "album_10",
      title: "Psy 6th (Six Rules), Part 1",
      duration: 252,
      parental_warning: false,
      release_date_original: "2012-07-15",
      image: {
        small: "https://i.ytimg.com/vi/9bZkp7q19f0/default.jpg",
        thumbnail: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
        large: "https://i.ytimg.com/vi/9bZkp7q19f0/maxresdefault.jpg",
        back: null,
      },
      artists: [{ id: 110, name: "Psy", roles: ["Main Artist"] }],
    },
    youtubeUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
  },
];

export class MusicProviderManager {
  private providerUrl: string | undefined;

  constructor() {
    // Lazy initialization - don't throw in constructor for test compatibility
    this.providerUrl = process.env.PROVIDER_URL;
  }

  private getProviderUrl(): string {
    if (!this.providerUrl) {
      throw new Error("PROVIDER_URL environment variable is required");
    }
    return this.providerUrl;
  }

  async search(query: string, offset = 0): Promise<z.infer<typeof RawSearchResponseSchema>> {
    try {
      const { q, offset: validOffset } = SearchParamsSchema.parse({
        q: query,
        offset,
      });

      if (!this.providerUrl) {
        // Safe local search in demo mode when PROVIDER_URL is missing
        console.log(`PROVIDER_URL not configured. Searching mock tracks for query: "${q}"`);
        const queryLower = q.toLowerCase();

        // Filter mock tracks by query matching title or performer name
        const filteredTracks = MOCK_TRACKS.filter(
          (track) =>
            track.title.toLowerCase().includes(queryLower) || track.performer.name.toLowerCase().includes(queryLower)
        );

        // Paginate mock tracks (up to 10 per page)
        const limit = 10;
        const pagedTracks = filteredTracks.slice(validOffset, validOffset + limit);

        const mockResponse = {
          data: {
            tracks: {
              limit,
              offset: validOffset,
              total: filteredTracks.length,
              items: pagedTracks.map(({ youtubeUrl: _youtubeUrl, ...rest }) => rest), // Strip out youtubeUrl helper field
            },
          },
        };

        return RawSearchResponseSchema.parse(mockResponse);
      }

      const searchUrl = new URL("/api/search", this.getProviderUrl());
      searchUrl.searchParams.set("q", q);
      searchUrl.searchParams.set("offset", validOffset.toString());

      const response = await fetch(searchUrl.toString());

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: unknown = await response.json();

      return RawSearchResponseSchema.parse(data);
    } catch (error) {
      throw new Error(`Search failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async stream(trackId: number) {
    try {
      const { id } = TrackParamsSchema.parse({ id: trackId });

      if (!this.providerUrl) {
        // Fallback to youtube stream resolver for mock tracks
        console.log(`PROVIDER_URL not configured. Resolving mock stream for trackId: ${id}`);
        const mockTrack = MOCK_TRACKS.find((track) => track.id === id);
        if (!mockTrack) {
          throw new Error(`Track with ID ${id} not found in mock list`);
        }

        console.log(`Preparing YouTube proxy URL for: ${mockTrack.youtubeUrl}`);
        const { videoId } = await getYoutubeMetadata(mockTrack.youtubeUrl);
        const proxiedUrl = buildYoutubeProxyUrl(videoId);

        const mockResponse = {
          success: true,
          data: {
            url: proxiedUrl,
          },
        };

        return StreamResponseSchema.parse(mockResponse);
      }

      const streamUrl = new URL("/api/track", this.getProviderUrl());
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
