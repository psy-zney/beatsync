import { RESOURCE_LIMITS } from "@/config";
import { BackupManager } from "@/managers/BackupManager";
import { streamTaskQueue, type StreamTaskQueue } from "@/managers/StreamTaskQueue";

export type MemoryPressureLevel = "normal" | "soft" | "hard";

interface MemoryPressureOptions {
  queue?: StreamTaskQueue;
  softLimitBytes?: number;
  hardLimitBytes?: number;
  onEmergencyBackup?: () => Promise<void>;
  onRestartRequired?: () => void;
  restartAfterHardChecks?: number;
}

export class MemoryPressureManager {
  private level: MemoryPressureLevel = "normal";
  private hardChecks = 0;
  private timer?: ReturnType<typeof setInterval>;
  private checking = false;
  private emergencyBackupStarted = false;
  private readonly queue: StreamTaskQueue;
  private readonly softLimitBytes: number;
  private readonly hardLimitBytes: number;
  private readonly onEmergencyBackup: () => Promise<void>;
  private readonly onRestartRequired: () => void;
  private readonly restartAfterHardChecks: number;

  constructor(options: MemoryPressureOptions = {}) {
    this.queue = options.queue ?? streamTaskQueue;
    this.softLimitBytes = options.softLimitBytes ?? RESOURCE_LIMITS.memorySoftLimitBytes;
    this.hardLimitBytes = options.hardLimitBytes ?? RESOURCE_LIMITS.memoryHardLimitBytes;
    this.onEmergencyBackup = options.onEmergencyBackup ?? (() => BackupManager.backupLocalState());
    this.onRestartRequired = options.onRestartRequired ?? (() => process.exit(1));
    this.restartAfterHardChecks = options.restartAfterHardChecks ?? 3;

    if (this.hardLimitBytes <= this.softLimitBytes) {
      throw new Error("MEMORY_HARD_LIMIT_MB must be greater than MEMORY_SOFT_LIMIT_MB");
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check(), RESOURCE_LIMITS.memoryCheckIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async check(rssBytes = process.memoryUsage().rss): Promise<MemoryPressureLevel> {
    if (this.checking) return this.level;
    this.checking = true;
    try {
      const recoveryLimit = this.softLimitBytes * 0.85;
      if (rssBytes < recoveryLimit) {
        if (this.level !== "normal") {
          console.log(`[Memory] Recovered at ${this.formatMb(rssBytes)} MB; accepting queued work again`);
        }
        this.level = "normal";
        this.hardChecks = 0;
        this.emergencyBackupStarted = false;
        this.queue.resume();
        return this.level;
      }

      if (rssBytes >= this.hardLimitBytes) {
        this.level = "hard";
        this.hardChecks++;
        this.queue.pause("critical memory pressure");
        const dropped = this.queue.shedPending(undefined, "critical memory pressure");
        const aborted = this.queue.abortActive();
        console.error(
          `[Memory] HARD limit reached (${this.formatMb(rssBytes)} MB): dropped ${dropped} queued and aborted ${aborted} active job(s)`
        );

        if (!this.emergencyBackupStarted) {
          this.emergencyBackupStarted = true;
          await this.onEmergencyBackup().catch((error) =>
            console.error("[Memory] Emergency local backup failed:", error)
          );
        }

        if (this.hardChecks >= this.restartAfterHardChecks) {
          console.error("[Memory] RSS did not recover; requesting a supervised restart");
          this.onRestartRequired();
        }
        return this.level;
      }

      this.level = "soft";
      this.hardChecks = 0;
      this.queue.pause("high memory pressure");
      const pending = this.queue.getStats().pending;
      const dropped = this.queue.shedPending(Math.max(1, Math.ceil(pending / 2)), "high memory pressure");
      console.warn(`[Memory] Soft limit reached (${this.formatMb(rssBytes)} MB): dropped ${dropped} queued job(s)`);
      return this.level;
    } finally {
      this.checking = false;
    }
  }

  getStatus(): { level: MemoryPressureLevel; softLimitMb: number; hardLimitMb: number } {
    return {
      level: this.level,
      softLimitMb: this.softLimitBytes / 1024 / 1024,
      hardLimitMb: this.hardLimitBytes / 1024 / 1024,
    };
  }

  private formatMb(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(1);
  }
}

export const memoryPressureManager = new MemoryPressureManager();
