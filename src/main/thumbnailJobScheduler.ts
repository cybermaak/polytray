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

interface BatchJob {
  snapshot: BackgroundJob;
  pendingRequests: Map<string, ThumbnailJobRequest>;
  failedRequests: Map<string, ThumbnailJobRequest>;
  done: Promise<void>;
  resolveDone: () => void;
  paused: boolean;
  cancelled: boolean;
  active: number;
  cancelledItems: number;
  unretainedFailures: number;
  terminalEmitted: boolean;
  pauseWaiters: Array<() => void>;
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
  retainedJobItems: number;
  retainedFailureRequests: number;
  retainedErrorDetails: number;
}

export class ThumbnailJobCancelledError extends Error {
  readonly code = "THUMBNAIL_CANCELLED";
  constructor() { super("Thumbnail job cancelled"); this.name = "ThumbnailJobCancelledError"; }
}

const HISTORY_LIMIT = 20;
const ERROR_LIMIT = 64;
const RETRY_REQUEST_LIMIT = 256;

export interface ThumbnailProgressEvent {
  current: number;
  total: number;
  filename: string;
  phase: "start" | "progress" | "done";
  outcome: "running" | "completed" | "partial" | "failed" | "cancelled";
  generated: number;
  failed: number;
  cancelled: number;
  pending: number;
}

export function createThumbnailProgressEvent(job: BackgroundJob, total: number): ThumbnailProgressEvent {
  const generated = job.counts.thumbnailsSucceeded;
  const failed = job.counts.thumbnailsFailed;
  const pending = job.counts.thumbnailsPending;
  const outcome = job.state === "queued" || job.state === "running" || job.state === "pausing" || job.state === "paused" || job.state === "cancelling"
    ? "running"
    : job.state;
  return {
    current: generated,
    total,
    filename: "",
    phase: outcome === "completed" ? "done" : "progress",
    outcome,
    generated,
    failed,
    cancelled: Math.max(0, total - generated - failed - pending),
    pending,
  };
}

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
  const stats: ThumbnailSchedulerStats = {
    queueDepth: 0, completed: 0, failed: 0, cancelled: 0, retries: 0, active: 0,
    retainedJobItems: 0, retainedFailureRequests: 0, retainedErrorDetails: 0,
  };

  const keyOf = (request: ThumbnailJobRequest) => request.dedupeKey ?? request.filePath;

  function emitJob(job: BatchJob) {
    job.snapshot.updatedAt = Date.now();
    const isTerminal = ["completed", "partial", "failed", "cancelled"].includes(job.snapshot.state);
    if (isTerminal && job.terminalEmitted) return;
    if (isTerminal) job.terminalEmitted = true;
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
    const hasCancelledItems = job.cancelledItems > 0;
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

  function addError(job: BatchJob, request: ThumbnailJobRequest, error: Error) {
    const detail: BackgroundJobError = {
      path: request.filePath,
      phase: "thumbnail",
      code: "THUMBNAIL_FAILED",
      message: error.message,
      retryable: true,
    };
    if (job.snapshot.errors.length < ERROR_LIMIT) job.snapshot.errors.push(detail);
    if (job.failedRequests.size >= RETRY_REQUEST_LIMIT) {
      job.unretainedFailures += 1;
      const warning: BackgroundJobError = {
        path: null,
        phase: "thumbnail",
        code: "THUMBNAIL_RETRY_LIMIT",
        message: `Retry history is full; ${job.unretainedFailures} additional failed request(s) were not retained.`,
        retryable: false,
      };
      const warningIndex = job.snapshot.errors.findIndex((item) => item.code === warning.code);
      if (warningIndex >= 0) job.snapshot.errors[warningIndex] = warning;
      else if (job.snapshot.errors.length < ERROR_LIMIT) job.snapshot.errors.push(warning);
      else job.snapshot.errors[ERROR_LIMIT - 1] = warning;
    } else {
      job.failedRequests.set(keyOf(request), request);
    }
  }

  function settleConsumer(consumer: Consumer, result: string | null, error?: Error) {
    if (consumer.settled) return;
    consumer.settled = true;
    const job = jobs.get(consumer.jobId);
    if (job) {
      const key = consumerKey(consumer);
      const request = job.pendingRequests.get(key);
      if (request) {
        job.pendingRequests.delete(key);
        job.snapshot.counts.thumbnailsPending = Math.max(0, job.snapshot.counts.thumbnailsPending - 1);
        if (error instanceof ThumbnailJobCancelledError) job.cancelledItems += 1;
        else if (result) job.snapshot.counts.thumbnailsSucceeded += 1;
        else {
          job.snapshot.counts.thumbnailsFailed += 1;
          addError(job, request, error ?? new Error("Thumbnail generation returned no image"));
        }
      }
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
    stats.retainedJobItems = [...jobs.values()].reduce((total, job) => total + job.pendingRequests.size, 0);
    stats.retainedFailureRequests = [...jobs.values()].reduce((total, job) => total + job.failedRequests.size, 0);
    stats.retainedErrorDetails = [...jobs.values()].reduce((total, job) => total + job.snapshot.errors.length, 0);
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
      pendingRequests: new Map(unique),
      failedRequests: new Map(),
      done,
      resolveDone,
      paused: false,
      cancelled: false,
      active: 0,
      cancelledItems: 0,
      unretainedFailures: 0,
      terminalEmitted: false,
      pauseWaiters: [],
    };
    batch.snapshot.counts.thumbnailsPending = batch.pendingRequests.size;
    jobs.set(jobId, batch);
    pruneHistory();
    emitJob(batch);
    if (batch.pendingRequests.size === 0) { batch.snapshot.state = "completed"; batch.resolveDone(); emitJob(batch); }
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
    const results = [...jobs.get(batch.jobId)!.pendingRequests.values()].map((request) =>
      addRequest(batch.jobId, request).then(
        (thumbnailPath) => ({ request, thumbnailPath, error: null as Error | null }),
        (error) => ({ request, thumbnailPath: null, error: error instanceof Error ? error : new Error(String(error)) }),
      ),
    );
    void runQueue();
    return { ...batch, resultPromises: results, results: Promise.all(results) };
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
    for (const [key] of job.pendingRequests) {
      job.pendingRequests.delete(key);
      job.cancelledItems += 1;
      job.snapshot.counts.thumbnailsPending = Math.max(0, job.snapshot.counts.thumbnailsPending - 1);
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
    const failed = [...job.failedRequests.entries()];
    if (!failed.length) return;
    job.snapshot.counts.thumbnailsFailed -= failed.length;
    job.snapshot.counts.thumbnailsPending += failed.length;
    for (const [key, request] of failed) job.pendingRequests.set(key, request);
    job.failedRequests.clear();
    job.snapshot.errors = [];
    if (job.unretainedFailures > 0) job.snapshot.errors.push({
      path: null, phase: "thumbnail", code: "THUMBNAIL_RETRY_LIMIT",
      message: `${job.unretainedFailures} failed request(s) were not retained and cannot be retried by this job.`, retryable: false,
    });
    job.cancelled = false;
    job.paused = false;
    job.terminalEmitted = false;
    job.done = new Promise<void>((resolve) => { job.resolveDone = resolve; });
    updateJobState(job);
    for (const [, request] of failed) void addRequest(jobId, request, 1);
    void runQueue();
    await job.done;
  }

  return {
    enqueue,
    enqueueBatch,
    getStats: () => ({
      ...stats,
      queueDepth: queue.size,
      retainedJobItems: [...jobs.values()].reduce((total, job) => total + job.pendingRequests.size, 0),
      retainedFailureRequests: [...jobs.values()].reduce((total, job) => total + job.failedRequests.size, 0),
      retainedErrorDetails: [...jobs.values()].reduce((total, job) => total + job.snapshot.errors.length, 0),
    }),
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
          const request = job?.pendingRequests.get(consumer.key);
          return !predicate || !!request && predicate(request);
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
          const request = job?.pendingRequests.get(consumer.key);
          return !predicate || !!request && predicate(request);
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
