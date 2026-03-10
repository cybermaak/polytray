import { RuntimeSettingsData } from "../shared/types";

export interface ThumbnailJobRequest {
  filePath: string;
  ext: string;
  settings: RuntimeSettingsData;
  source: "scan" | "watch" | "manual";
  priority?: number;
  retries?: number;
}

interface SchedulerJob extends ThumbnailJobRequest {
  priority: number;
  retries: number;
  consumers: Array<{
    resolve: (value: string | null) => void;
    reject: (error: Error) => void;
  }>;
}

interface SchedulerHooks {
  execute: (job: SchedulerJob) => Promise<string | null>;
  onStats?: (stats: ThumbnailSchedulerStats) => void;
}

export interface ThumbnailSchedulerStats {
  queueDepth: number;
  completed: number;
  failed: number;
  retries: number;
}

export function createThumbnailJobScheduler(hooks: SchedulerHooks) {
  const queue = new Map<string, SchedulerJob>();
  const activeJobs = new Map<string, SchedulerJob>();
  let running = false;
  const stats: ThumbnailSchedulerStats = {
    queueDepth: 0,
    completed: 0,
    failed: 0,
    retries: 0,
  };

  function emitStats() {
    stats.queueDepth = queue.size;
    hooks.onStats?.({ ...stats });
  }

  async function runQueue() {
    if (running) return;
    running = true;
    emitStats();

    try {
      while (queue.size > 0) {
        const job = [...queue.values()].sort((a, b) => b.priority - a.priority)[0];
        queue.delete(job.filePath);
        activeJobs.set(job.filePath, job);
        emitStats();

        try {
          const result = await hooks.execute(job);
          stats.completed += 1;
          for (const consumer of job.consumers) {
            consumer.resolve(result);
          }
        } catch (error) {
          if (job.retries > 0) {
            stats.retries += 1;
            queue.set(job.filePath, {
              ...job,
              retries: job.retries - 1,
            });
          } else {
            stats.failed += 1;
            for (const consumer of job.consumers) {
              consumer.reject(error instanceof Error ? error : new Error(String(error)));
            }
          }
        } finally {
          activeJobs.delete(job.filePath);
        }
      }
    } finally {
      running = false;
      emitStats();
    }
  }

  return {
    enqueue(request: ThumbnailJobRequest) {
      return new Promise<string | null>((resolve, reject) => {
        const existing = queue.get(request.filePath);
        const active = activeJobs.get(request.filePath);

        if (existing) {
          existing.priority = Math.max(existing.priority, request.priority ?? 0);
          existing.retries = Math.max(existing.retries, request.retries ?? 1);
          existing.settings = request.settings;
          existing.ext = request.ext;
          existing.source = request.source;
          existing.consumers.push({ resolve, reject });
        } else if (active) {
          active.consumers.push({ resolve, reject });
        } else {
          queue.set(request.filePath, {
            ...request,
            priority: request.priority ?? 0,
            retries: request.retries ?? 1,
            consumers: [{ resolve, reject }],
          });
        }

        void runQueue();
      });
    },
    getStats() {
      return { ...stats, queueDepth: queue.size };
    },
    clearPending(predicate?: (job: ThumbnailJobRequest) => boolean) {
      for (const [key, job] of queue.entries()) {
        if (!predicate || predicate(job)) {
          queue.delete(key);
          for (const consumer of job.consumers) {
            consumer.reject(new Error("Thumbnail job cancelled"));
          }
        }
      }
      emitStats();
    },
  };
}
