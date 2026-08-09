import { describe, expect, it } from "bun:test";
import { MemoryPressureManager } from "@/managers/MemoryPressureManager";
import { QueueRejectedError, StreamTaskQueue } from "@/managers/StreamTaskQueue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function expectQueueRejection(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    throw new Error("Expected queued work to be rejected");
  } catch (error) {
    expect(error).toBeInstanceOf(QueueRejectedError);
  }
}

describe("StreamTaskQueue", () => {
  it("bounds concurrent and waiting stream jobs", async () => {
    const queue = new StreamTaskQueue(1, 2);
    const first = deferred<string>();
    const firstJob = queue.run("first", () => first.promise);
    const secondJob = queue.run("second", () => Promise.resolve("second-ok"));
    const thirdJob = queue.run("third", () => Promise.resolve("third-ok"));

    expect(queue.getStats()).toMatchObject({ active: 1, pending: 2 });
    await expectQueueRejection(queue.run("overflow", () => Promise.resolve("nope")));

    first.resolve("first-ok");
    expect(await firstJob).toBe("first-ok");
    expect(await secondJob).toBe("second-ok");
    expect(await thirdJob).toBe("third-ok");
  });

  it("drops newest queued jobs and resumes after pressure clears", async () => {
    const queue = new StreamTaskQueue(1, 3);
    const active = deferred<void>();
    const activeJob = queue.run("active", () => active.promise);
    const older = queue.run("older", () => Promise.resolve("kept"));
    const newest = queue.run("newest", () => Promise.resolve("dropped"));

    queue.pause("test pressure");
    expect(queue.shedPending(1)).toBe(1);
    await expectQueueRejection(newest);

    active.resolve();
    await activeJob;
    await Promise.resolve();
    expect(queue.getStats().active).toBe(0);
    queue.resume();
    expect(await older).toBe("kept");
  });
});

describe("MemoryPressureManager", () => {
  it("sheds queued work at soft pressure and accepts work after recovery", async () => {
    const queue = new StreamTaskQueue(1, 3);
    const active = deferred<void>();
    const activeJob = queue.run("active", () => active.promise);
    const queued = queue.run("queued", () => Promise.resolve());
    const manager = new MemoryPressureManager({
      queue,
      softLimitBytes: 100,
      hardLimitBytes: 200,
      onEmergencyBackup: () => Promise.resolve(),
      onRestartRequired: () => undefined,
    });

    expect(await manager.check(150)).toBe("soft");
    expect(queue.getStats().paused).toBe(true);
    await expectQueueRejection(queued);

    expect(await manager.check(80)).toBe("normal");
    expect(queue.getStats().paused).toBe(false);
    active.resolve();
    await activeJob;
  });

  it("backs up, aborts active work, then requests restart if RSS stays hard", async () => {
    const queue = new StreamTaskQueue(1, 1);
    let backups = 0;
    let restarts = 0;
    const activeJob = queue.run(
      "active",
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason instanceof Error ? signal.reason : new Error("critical memory pressure")),
            { once: true }
          );
        })
    );
    const manager = new MemoryPressureManager({
      queue,
      softLimitBytes: 100,
      hardLimitBytes: 200,
      restartAfterHardChecks: 2,
      onEmergencyBackup: () => {
        backups++;
        return Promise.resolve();
      },
      onRestartRequired: () => {
        restarts++;
      },
    });

    expect(await manager.check(250)).toBe("hard");
    try {
      await activeJob;
      throw new Error("Expected active work to be aborted");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("critical memory pressure");
    }
    expect(backups).toBe(1);
    expect(restarts).toBe(0);

    await manager.check(250);
    expect(backups).toBe(1);
    expect(restarts).toBe(1);
  });
});
