import { randomUUID } from "crypto";
import type { RuntimeSettingsData } from "../shared/types";
import type { BackgroundJob, BackgroundJobError } from "../shared/backgroundJobs";

export interface ThumbnailJobRequest {
  filePath: string;
  ext: string;
  settings: RuntimeSettingsData;
  source: "scan" | "watch" | "manual";
  priority?: number;
  retries?: number;
  /** Full C4 identity key. Legacy callers fall back to filePath. */
  dedupeKey?: string;
}

interface Consumer {
  jobId: string;
  key: string;
  resolve: (value: string | null) => void;
  reject: (error: Error) => void;
  settled: boolean;
}

interface SchedulerJob extends ThumbnailJobRequest {
  priority: number;
  retries: number;
  controller: AbortController;
  consumers: Consumer[];
}

interface BatchItem {
  request: ThumbnailJobRequest;
  status: "pending" | "succeeded" | "failed" | "cancelled";
}

interface BatchJob {
  snapshot: BackgroundJob;
  items: BatchItem[];
  done: Promise<void>;
  resolveDone: () => void;
  paused: boolean;
  cancelled: boolean;
  active: number;
  pauseWaiters: Array<() => void>;
  errorsByKey: Map<string, BackgroundJobError>;
}

interface SchedulerHooks {
  execute: (job: SchedulerJob) => Promise<string | null>;
  onStats?: (stats: ThumbnailSchedulerStats) => void;
  onJobChanged?: (job: BackgroundJob) => void;
}

export interface ThumbnailSchedulerStats {
  queueDepth: number;
  completed: number;
  failed: number;
  cancelled: number;
  retries: number;
  active: number;
}

export class ThumbnailJobCancelledError extends Error {
  readonly code = "THUMBNAIL_CANCELLED";
  constructor() { super("Thumbnail job cancelled"); this.name = "ThumbnailJobCancelledError"; }
}

const HISTORY_LIMIT = 20;
const ERROR_LIMIT = 64;

function sourcePriority(request: ThumbnailJobRequest): number {
  if (request.priority !== undefined) return request.priority;
  return request.source === "manual" ? 3 : request.source === "watch" ? 2 : 1;
}

function makeSnapshot(jobId: string, state: BackgroundJob["state"], requests: ThumbnailJobRequest[] = []): BackgroundJob {
  const now = Date.now();
  return {
    jobId,
    kind: "thumbnail",
    rootPath: null,
    scopePath: requests.length === 1 ? requests[0].filePath : null,
    state,
    counts: {
      discovered: 0, indexed: 0, indexFailed: 0, metadataCompleted: 0, metadataFailed: 0,
      thumbnailsSucceeded: 0, thumbnailsFailed: 0, thumbnailsPending: 0,
    },
    errors: [],
    startedAt: null,
    updatedAt: now,
  };
}

export function createThumbnailJobScheduler(hooks: SchedulerHooks) {
  const queue = new Map<string, SchedulerJob>();
  const activeJobs = new Map<string, SchedulerJob>();
  const jobs = new Map<string, BatchJob>();
  const listeners = new Set<(job: BackgroundJob) => void>();
  const notificationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastNotificationAt = new Map<string, number>();
  let draining = false;
  const stats: ThumbnailSchedulerStats = { queueDepth: 0, completed: 0, failed: 0, cancelled: 0, retries: 0, active: 0 };

  const keyOf = (request: ThumbnailJobRequest) => request.dedupeKey ?? request.filePath;

  function emitJob(job: BatchJob) {
    job.snapshot.updatedAt = Date.now();
    const publish = () => {
      notificationTimers.delete(job.snapshot.jobId);
      const snapshot = { ...job.snapshot, counts: { ...job.snapshot.counts }, errors: [...job.snapshot.errors] };
      lastNotificationAt.set(job.snapshot.jobId, Date.now());
      try { hooks.onJobChanged?.(snapshot); } catch (error) { console.warn("[ThumbnailQueue] Job observer failed:", error); }
      for (const listener of listeners) {
        try { listener(snapshot); } catch (error) { console.warn("[ThumbnailQueue] Job listener failed:", error); }
      }
    };
    if (job.snapshot.state !== "running") {
      const timer = notificationTimers.get(job.snapshot.jobId);
      if (timer) clearTimeout(timer);
      publish();
      return;
    }
    const elapsed = Date.now() - (lastNotificationAt.get(job.snapshot.jobId) ?? 0);
    if (elapsed >= 250) { publish(); return; }
    if (!notificationTimers.has(job.snapshot.jobId)) {
      notificationTimers.set(job.snapshot.jobId, setTimeout(publish, 250 - elapsed));
    }
  }

  function updateJobState(job: BatchJob) {
    const counts = job.snapshot.counts;
    const hasCancelledItems = job.items.some((item) => item.status === "cancelled");
    if (job.cancelled) job.snapshot.state = job.active > 0 ? "cancelling" : "cancelled";
    else if (counts.thumbnailsPending > 0 && job.paused) job.snapshot.state = job.active > 0 ? "pausing" : "paused";
    else if (counts.thumbnailsPending > 0) job.snapshot.state = job.snapshot.startedAt === null ? "queued" : "running";
    else if (hasCancelledItems && (counts.thumbnailsSucceeded > 0 || counts.thumbnailsFailed > 0) || counts.thumbnailsFailed > 0 && counts.thumbnailsSucceeded > 0) job.snapshot.state = "partial";
    else if (counts.thumbnailsFailed > 0) job.snapshot.state = "failed";
    else if (counts.thumbnailsSucceeded > 0) job.snapshot.state = "completed";
    else job.snapshot.state = "cancelled";
    emitJob(job);
    pruneHistory();
  }

  function pruneHistory() {
    while (jobs.size > HISTORY_LIMIT) {
      const terminal = [...jobs.entries()].find(([, candidate]) =>
        ["completed", "partial", "failed", "cancelled"].includes(candidate.snapshot.state),
      );
      if (!terminal) return;
      const timer = notificationTimers.get(terminal[0]);
      if (timer) clearTimeout(timer);
      notificationTimers.delete(terminal[0]);
      lastNotificationAt.delete(terminal[0]);
      jobs.delete(terminal[0]);
    }
  }

  function addError(job: BatchJob, key: string, request: ThumbnailJobRequest, error: Error) {
    const detail: BackgroundJobError = {
      path: request.filePath,
      phase: "thumbnail",
      code: "THUMBNAIL_FAILED",
      message: error.message,
      retryable: true,
    };
    job.errorsByKey.set(key, detail);
    job.snapshot.errors = [...job.errorsByKey.values()].slice(-ERROR_LIMIT);
  }

  function settleConsumer(consumer: Consumer, result: string | null, error?: Error) {
    if (consumer.settled) return;
    consumer.settled = true;
    const job = jobs.get(consumer.jobId);
    if (job) {
      const item = job.items.find((candidate) => keyOf(candidate.request) === consumerKey(consumer));
      if (item && item.status === "pending") {
        item.status = error instanceof ThumbnailJobCancelledError ? "cancelled" : result ? "succeeded" : "failed";
        job.snapshot.counts.thumbnailsPending = Math.max(0, job.snapshot.counts.thumbnailsPending - 1);
        if (item.status === "succeeded") job.snapshot.counts.thumbnailsSucceeded += 1;
        else if (item.status === "failed") job.snapshot.counts.thumbnailsFailed += 1;
      }
      if (error && !(error instanceof ThumbnailJobCancelledError)) addError(job, consumerKey(consumer), item?.request ?? { filePath: "", ext: "", source: "scan", settings: {} as RuntimeSettingsData }, error);
      updateJobState(job);
      if (job.snapshot.counts.thumbnailsPending === 0) job.resolveDone();
    }
    if (error) consumer.reject(error);
    else consumer.resolve(result);
  }

  // The key is attached to the consumer at enqueue time via a private property.
  function consumerKey(consumer: Consumer): string { return consumer.key; }

  function emitStats() {
    stats.queueDepth = queue.size;
    stats.active = activeJobs.size;
    hooks.onStats?.({ ...stats });
  }

  function resolvePausedJobs() {
    for (const job of jobs.values()) {
      if ((job.paused || job.cancelled) && job.active === 0) {
        updateJobState(job);
        const waiters = job.pauseWaiters.splice(0);
        for (const resolve of waiters) resolve();
        emitJob(job);
      }
    }
  }

  function pickNext(): [string, SchedulerJob] | null {
    const candidates = [...queue.entries()].filter(([, task]) => task.consumers.some((c) => !jobs.get(c.jobId)?.paused && !jobs.get(c.jobId)?.cancelled));
    candidates.sort((a, b) => b[1].priority - a[1].priority);
    return candidates[0] ?? null;
  }

  async function runQueue() {
    if (draining) return;
    draining = true;
    emitStats();
    try {
      while (queue.size > 0) {
        const selected = pickNext();
        if (!selected) break;
        const [key, task] = selected;
        if (queue.get(key) !== task) continue;
        queue.delete(key);
        activeJobs.set(key, task);
        for (const consumer of task.consumers) {
          const owner = jobs.get(consumer.jobId);
          if (owner && !owner.snapshot.startedAt) owner.snapshot.startedAt = Date.now();
          if (owner) { owner.active += 1; updateJobState(owner); }
        }
        emitStats();
        let remaining = task.retries;
        let result: string | null = null;
        let failure: Error | null = null;
        try {
          while (true) {
            try {
              result = await hooks.execute(task);
              if (result) { failure = null; break; }
              failure = new Error("Thumbnail generation returned no image");
            } catch (error) {
              failure = error instanceof Error ? error : new Error(String(error));
            }
            if (task.controller.signal.aborted || failure instanceof ThumbnailJobCancelledError || remaining <= 0) break;
            remaining -= 1;
            stats.retries += 1;
          }
          if (task.controller.signal.aborted || failure instanceof ThumbnailJobCancelledError) {
            if (!task.controller.signal.aborted) stats.cancelled += task.consumers.length;
            for (const consumer of task.consumers) settleConsumer(consumer, null, new ThumbnailJobCancelledError());
          } else if (failure) {
            stats.failed += 1;
            for (const consumer of task.consumers) settleConsumer(consumer, null, failure);
          } else {
            stats.completed += 1;
            for (const consumer of task.consumers) settleConsumer(consumer, result);
          }
        } finally {
          activeJobs.delete(key);
          for (const consumer of task.consumers) {
            const owner = jobs.get(consumer.jobId);
            if (owner) owner.active = Math.max(0, owner.active - 1);
          }
          resolvePausedJobs();
          emitStats();
        }
      }
    } finally {
      draining = false;
      resolvePausedJobs();
      emitStats();
      // A task may have been enqueued as the drain was ending.
      if (pickNext()) void runQueue();
    }
  }

  function createBatch(requests: ThumbnailJobRequest[]) {
    const jobId = randomUUID();
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    const unique = new Map<string, ThumbnailJobRequest>();
    for (const request of requests) unique.set(keyOf(request), request);
    const batch: BatchJob = {
      snapshot: makeSnapshot(jobId, "queued", [...unique.values()]),
      items: [...unique.values()].map((request) => ({ request, status: "pending" })),
      done,
      resolveDone,
      paused: false,
      cancelled: false,
      active: 0,
      pauseWaiters: [],
      errorsByKey: new Map(),
    };
    batch.snapshot.counts.thumbnailsPending = batch.items.length;
    jobs.set(jobId, batch);
    pruneHistory();
    emitJob(batch);
    if (batch.items.length === 0) { batch.snapshot.state = "completed"; batch.resolveDone(); emitJob(batch); }
    return { jobId, done };
  }

  function addRequest(jobId: string, request: ThumbnailJobRequest, retries = request.retries ?? 1) {
    const key = keyOf(request);
    const batch = jobs.get(jobId)!;
    const consumer: Consumer = {
      jobId, key, settled: false,
      resolve: () => undefined,
      reject: () => undefined,
    };
    const consumerPromise = new Promise<string | null>((resolve, reject) => { consumer.resolve = resolve; consumer.reject = reject; });
    const queued = queue.get(key);
    const active = activeJobs.get(key);
    const task = queued ?? active;
    if (task) {
      task.priority = Math.max(task.priority, sourcePriority(request));
      task.retries = Math.max(task.retries, Math.min(1, Math.max(0, retries)));
      task.consumers.push(consumer);
    } else {
      queue.set(key, { ...request, priority: sourcePriority(request), retries: Math.min(1, Math.max(0, retries)), controller: new AbortController(), consumers: [consumer] });
    }
    void consumerPromise.catch(() => undefined);
    return consumerPromise;
  }

  function enqueueBatch(requests: ThumbnailJobRequest[]) {
    const batch = createBatch(requests);
    const results = jobs.get(batch.jobId)!.items.map((item) =>
      addRequest(batch.jobId, item.request).then(
        (thumbnailPath) => ({ request: item.request, thumbnailPath, error: null as Error | null }),
        (error) => ({ request: item.request, thumbnailPath: null, error: error instanceof Error ? error : new Error(String(error)) }),
      ),
    );
    void runQueue();
    return { ...batch, results: Promise.all(results) };
  }

  function enqueue(request: ThumbnailJobRequest) {
    const batch = createBatch([request]);
    const result = addRequest(batch.jobId, request);
    void runQueue();
    return result;
  }

  async function cancel(jobId: string) {
    const job = jobs.get(jobId);
    if (!job || job.snapshot.state === "completed" || job.snapshot.state === "failed" || job.snapshot.state === "partial" || job.snapshot.state === "cancelled") return;
    job.cancelled = true;
    let cancelledCount = 0;
    for (const [key, task] of queue) {
      const owned = task.consumers.filter((consumer) => consumer.jobId === jobId);
      if (!owned.length) continue;
      task.consumers = task.consumers.filter((consumer) => consumer.jobId !== jobId);
      for (const consumer of owned) { settleConsumer(consumer, null, new ThumbnailJobCancelledError()); cancelledCount += 1; }
      if (task.consumers.length === 0) queue.delete(key);
    }
    for (const task of activeJobs.values()) {
      const owned = task.consumers.filter((consumer) => consumer.jobId === jobId);
      if (!owned.length) continue;
      const ownsWholeTask = task.consumers.every((consumer) => consumer.jobId === jobId);
      if (ownsWholeTask) {
        task.controller.abort();
        for (const consumer of owned) {
          settleConsumer(consumer, null, new ThumbnailJobCancelledError());
          cancelledCount += 1;
        }
      } else {
        task.consumers = task.consumers.filter((consumer) => !owned.includes(consumer));
        for (const consumer of owned) {
          settleConsumer(consumer, null, new ThumbnailJobCancelledError());
          job.active = Math.max(0, job.active - 1);
          cancelledCount += 1;
        }
      }
    }
    for (const item of job.items) {
      if (item.status === "pending") {
        item.status = "cancelled";
        job.snapshot.counts.thumbnailsPending = Math.max(0, job.snapshot.counts.thumbnailsPending - 1);
      }
    }
    if (job.snapshot.counts.thumbnailsPending === 0) job.resolveDone();
    updateJobState(job);
    stats.cancelled += cancelledCount;
    emitStats();
    if (job.active > 0) await new Promise<void>((resolve) => job.pauseWaiters.push(resolve));
  }

  async function pause(jobId: string) {
    const job = jobs.get(jobId);
    if (!job || ["completed", "partial", "failed", "cancelled"].includes(job.snapshot.state)) return;
    if (job.paused && job.active === 0) return;
    job.paused = true;
    job.snapshot.state = job.active ? "pausing" : "paused";
    emitJob(job);
    if (!job.active) return;
    await new Promise<void>((resolve) => job.pauseWaiters.push(resolve));
  }

  async function resume(jobId: string) {
    const job = jobs.get(jobId);
    if (!job || !job.paused || job.cancelled) return;
    job.paused = false;
    updateJobState(job);
    void runQueue();
  }

  async function retryFailures(jobId: string) {
    const job = jobs.get(jobId);
    if (!job) return;
    const failed = job.items.filter((item) => item.status === "failed");
    if (!failed.length) return;
    job.snapshot.counts.thumbnailsFailed -= failed.length;
    job.snapshot.counts.thumbnailsPending += failed.length;
    for (const item of failed) item.status = "pending";
    job.errorsByKey.clear();
    job.snapshot.errors = [];
    job.cancelled = false;
    job.paused = false;
    job.done = new Promise<void>((resolve) => { job.resolveDone = resolve; });
    updateJobState(job);
    for (const item of failed) void addRequest(jobId, item.request, 1);
    void runQueue();
    await job.done;
  }

  return {
    enqueue,
    enqueueBatch,
    getStats: () => ({ ...stats, queueDepth: queue.size }),
    getJobs: () => [...jobs.values()].map((job) => ({ ...job.snapshot, counts: { ...job.snapshot.counts }, errors: [...job.snapshot.errors] })),
    onJobChanged(callback: (job: BackgroundJob) => void) { listeners.add(callback); return () => listeners.delete(callback); },
    pause,
    resume,
    cancel,
    retryFailures,
    clearPending(predicate?: (job: ThumbnailJobRequest) => boolean) {
      for (const [key, task] of queue) {
        const removed = task.consumers.filter((consumer) => {
          const job = jobs.get(consumer.jobId);
          const item = job?.items.find((candidate) => keyOf(candidate.request) === consumer.key);
          return !predicate || !!item && predicate(item.request);
        });
        if (!removed.length) continue;
        task.consumers = task.consumers.filter((consumer) => !removed.includes(consumer));
        for (const consumer of removed) settleConsumer(consumer, null, new ThumbnailJobCancelledError());
        stats.cancelled += removed.length;
        if (task.consumers.length === 0) queue.delete(key);
      }
      for (const task of activeJobs.values()) {
        const removed = task.consumers.filter((consumer) => {
          const job = jobs.get(consumer.jobId);
          const item = job?.items.find((candidate) => keyOf(candidate.request) === consumer.key);
          return !predicate || !!item && predicate(item.request);
        });
        if (!removed.length) continue;
        if (removed.length === task.consumers.length) task.controller.abort();
        task.consumers = task.consumers.filter((consumer) => !removed.includes(consumer));
        for (const consumer of removed) {
          settleConsumer(consumer, null, new ThumbnailJobCancelledError());
          const owner = jobs.get(consumer.jobId);
          if (owner) owner.active = Math.max(0, owner.active - 1);
        }
        stats.cancelled += removed.length;
      }
      resolvePausedJobs();
      emitStats();
    },
  };
}
