import pLimit from "p-limit";
import { globalManager } from "@/managers/GlobalManager";
import type { RoomBackupType, ServerBackupType } from "@/managers/RoomManager";
import { ServerBackupSchema } from "@/managers/RoomManager";

interface RoomRestoreResult {
  room: {
    id: string;
    numClients: number;
    numAudioSources: number;
    globalVolume: number;
  };
  success: boolean;
  error?: string;
}

export class BackupManager {
  private static readonly DEFAULT_RESTORE_CONCURRENCY = 1000;
  private static readonly FILENAME = "beatsync-state.json";

  private static async downloadFromGist(): Promise<ServerBackupType | null> {
    const gistId = process.env.GITHUB_GIST_ID;
    const token = process.env.GITHUB_TOKEN;
    if (!gistId || !token) {
      console.log("No GITHUB_GIST_ID or GITHUB_TOKEN configured. Skipping restore.");
      return null;
    }
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.statusText}`);
    }
    const gist = (await res.json()) as { files: Record<string, { content: string }> };
    const file = gist.files[this.FILENAME];
    if (!file) return null;
    return JSON.parse(file.content) as ServerBackupType;
  }

  private static async uploadToGist(data: ServerBackupType): Promise<void> {
    const gistId = process.env.GITHUB_GIST_ID;
    const token = process.env.GITHUB_TOKEN;
    if (!gistId || !token) return;

    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: {
          [this.FILENAME]: {
            content: JSON.stringify(data, null, 2),
          },
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.statusText}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private static async restoreRoom(roomId: string, roomData: RoomBackupType): Promise<RoomRestoreResult> {
    try {
      const room = globalManager.getOrCreateRoom(roomId);

      room.setAudioSources(roomData.audioSources);
      room.restoreClientData(roomData.clientDatas);

      const playbackStateIsValidTrack = roomData.audioSources.some(
        (source) => source.url === roomData.playbackState.audioSource
      );

      if (playbackStateIsValidTrack) {
        room.restorePlaybackState(roomData.playbackState);
      } else {
        console.log(`Room ${roomId}: Playing track no longer exists, resetting playback to paused`);
      }

      if (roomData.chat) {
        room.restoreChatHistory(roomData.chat);
      }

      globalManager.scheduleRoomCleanup(roomId);
      return {
        room: {
          id: roomId,
          numClients: roomData.clientDatas.length,
          numAudioSources: roomData.audioSources.length,
          globalVolume: roomData.globalVolume,
        },
        success: true,
      };
    } catch (error) {
      console.error(`❌ Failed to restore room ${roomId}:`, error);
      return {
        room: {
          id: roomId,
          globalVolume: roomData.globalVolume,
          numClients: roomData.clientDatas.length,
          numAudioSources: roomData.audioSources.length,
        },
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  static async backupState(): Promise<void> {
    try {
      if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_GIST_ID) return;

      const rooms: ServerBackupType["data"]["rooms"] = {};
      globalManager.forEachRoom((room, roomId) => {
        rooms[roomId] = room.createBackup();
      });

      const backupData: ServerBackupType = {
        timestamp: Date.now(),
        data: { rooms },
      };

      await this.uploadToGist(backupData);
      console.log(`✅ State backup completed to Gist (${Object.keys(rooms).length} rooms)`);
    } catch (error) {
      const msg = error instanceof Error ? error.message.split("\n")[0] : String(error);
      console.error(`❌ State backup failed: ${msg}`);
      throw error;
    }
  }

  static async restoreState(): Promise<boolean> {
    try {
      console.log("🔍 Looking for state backups on GitHub Gist...");

      const rawBackupData = await this.downloadFromGist();
      if (!rawBackupData) {
        console.log("📭 No backups found");
        return false;
      }

      console.log(`📥 Restoring from Gist`);

      const parseResult = ServerBackupSchema.safeParse(rawBackupData);
      if (!parseResult.success) {
        throw new Error(`Invalid backup data format: ${parseResult.error.message}`);
      }

      const backupData = parseResult.data;
      const concurrency = this.DEFAULT_RESTORE_CONCURRENCY;
      const limit = pLimit(concurrency);
      const roomEntries = Object.entries(backupData.data.rooms);

      const restorePromises = roomEntries.map(([roomId, roomData]) => limit(() => this.restoreRoom(roomId, roomData)));
      const results = await Promise.allSettled(restorePromises);

      const successful: RoomRestoreResult[] = [];
      const failed: RoomRestoreResult[] = [];

      results.forEach((result) => {
        if (result.status !== "fulfilled") {
          failed.push({
            room: { id: "unknown", numClients: 0, numAudioSources: 0, globalVolume: 0 },
            success: false,
            error: String(result.reason),
          });
          return;
        }
        if (result.value.success) {
          successful.push(result.value);
        } else {
          failed.push(result.value);
        }
      });

      console.log(`✅ State restoration completed:`);
      console.log(`   - Successfully restored ${successful.length} rooms`);
      if (failed.length > 0) {
        console.log(`   - Failed to restore: ${failed.length} rooms`);
      }

      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message.split("\n")[0] : String(error);
      console.error(`❌ State restore failed: ${msg}`);
      return false;
    }
  }
}
