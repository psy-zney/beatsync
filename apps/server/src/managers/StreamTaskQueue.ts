import { RESOURCE_LIMITS } from "@/config";

type TaskRunner<T> = (signal: AbortSignal) => Promise<T>;

interface PendingTask<T> {
  id: string;
  run: TaskRunner<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export class QueueRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueRejectedError";
  }
}

/**
 * Bounded queue for downloads/transcodes. Keeping this global prevents multiple
 * rooms from each buffering a large audio file at the same time.
 */
export class StreamTaskQueue {
  private pending: PendingTask<unknown>[] = [];
  private active = new Map<string, AbortController>();
  private pausedReason: string | null = null;

  constructor(
    private readonly concurrency = RESOURCE_LIMITS.streamConcurrency,
    private readonly maxQueueSize = RESOURCE_LIMITS.streamQueueSize
  ) {}

  run<T>(id: string, task: TaskRunner<T>): Promise<T> {
    if (this.pausedReason) {
      return Promise.reject(new QueueRejectedError(`Server is shedding load: ${this.pausedReason}`));
    }
    if (this.pending.length >= this.maxQueueSize) {
      return Promise.reject(new QueueRejectedError(`Stream queue is full (${this.maxQueueSize} waiting jobs)`));
    }

    return new Promise<T>((resolve, reject) => {
      this.pending.push({ id, run: task, resolve, reject } as PendingTask<unknown>);
      this.pump();
    });
  }

  pause(reason: string): void {
    this.pausedReason = reason;
  }

  resume(): void {
    this.pausedReason = null;
    this.pump();
  }

  /** Drop newest waiting work first, preserving jobs that have waited longest. */
  shedPending(count = this.pending.length, reason = "memory pressure"): number {
    const dropCount = Math.min(Math.max(0, count), this.pending.length);
    const dropped = this.pending.splice(this.pending.length - dropCount, dropCount);
    for (const task of dropped) {
      task.reject(new QueueRejectedError(`Queued stream job ${task.id} dropped: ${reason}`));
    }
    return dropped.length;
  }

  abortActive(reason = "critical memory pressure"): number {
    for (const controller of this.active.values()) {
      controller.abort(new Error(reason));
    }
    return this.active.size;
  }

  getStats(): { active: number; pending: number; paused: boolean; pausedReason: string | null } {
    return {
      active: this.active.size,
      pending: this.pending.length,
      paused: this.pausedReason !== null,
      pausedReason: this.pausedReason,
    };
  }

  private pump(): void {
    if (this.pausedReason) return;

    while (this.active.size < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift()!;
      const controller = new AbortController();
      const activeKey = `${task.id}:${crypto.randomUUID()}`;
      this.active.set(activeKey, controller);

      void task
        .run(controller.signal)
        .then(task.resolve, task.reject)
        .finally(() => {
          this.active.delete(activeKey);
          this.pump();
        });
    }
  }
}

export const streamTaskQueue = new StreamTaskQueue();
