import fs from 'node:fs';
import path from 'node:path';

export interface Barrier<T = void> {
  reached: Promise<T>;
  release(value: T): void;
  cancel(reason?: Error): void;
  wait(signal?: AbortSignal): Promise<T>;
}

/** A deterministic gate for test-controlled discovery/parse work; never relies on timers. */
export function createBarrier<T = void>(): Barrier<T> {
  let markReached!: (value: T) => void;
  let entered = false;
  let result: { ok: true; value: T } | { ok: false; error: Error } | null = null;
  const waiters: Array<{ resolve(value: T): void; reject(error: Error): void; signal?: AbortSignal; onAbort?: () => void }> = [];
  const reached = new Promise<T>((resolve) => { markReached = resolve; });
  const settle = (next: { ok: true; value: T } | { ok: false; error: Error }) => {
    if (result) return;
    result = next;
    for (const waiter of waiters.splice(0)) {
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
      if (next.ok) waiter.resolve(next.value); else waiter.reject(next.error);
    }
  };
  return {
    reached,
    release: (value) => settle({ ok: true, value }),
    cancel: (reason = new Error('Barrier cancelled')) => settle({ ok: false, error: reason }),
    async wait(signal) {
      if (!entered) { entered = true; markReached(undefined as T); }
      if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
      if (result) { if (result.ok) return result.value; throw result.error; }
      return new Promise<T>((resolve, reject) => {
        const waiter: (typeof waiters)[number] = { resolve, reject, signal };
        if (signal) {
          waiter.onAbort = () => {
            signal.removeEventListener('abort', waiter.onAbort!);
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            reject(signal.reason ?? new Error('Aborted'));
          };
          signal.addEventListener('abort', waiter.onAbort, { once: true });
        }
        waiters.push(waiter);
        if (signal?.aborted) waiter.onAbort?.();
      });
    },
  };
}

export function createScenarioGates() {
  return {
    subtreeDiscovery: createBarrier<void>(),
    directoryFailure: createBarrier<Error>(),
    parsing: createBarrier<void>(),
    extraction: createBarrier<void>(),
    cancellation: new AbortController(),
  };
}

export interface ProbeRecord { name: string; at: number; value?: number | string | boolean | null; }

/** JSONL output is confined to the caller's scratch directory. */
export function createProbeRecorder(scratchDir: string, filename = 'performance-probes.jsonl') {
  fs.mkdirSync(scratchDir, { recursive: true });
  const filePath = path.join(scratchDir, filename);
  return {
    filePath,
    record(name: string, value?: ProbeRecord['value']) {
      fs.appendFileSync(filePath, `${JSON.stringify({ name, at: performance.now(), value })}\n`);
    },
  };
}

export function startHeartbeatProbe(onGap: (gapMs: number) => void, intervalMs = 25) {
  let previous = performance.now();
  const timer = setInterval(() => { const now = performance.now(); onGap(now - previous); previous = now; }, intervalMs);
  return () => clearInterval(timer);
}

/** Start inside Electron's main process to collect gaps while IPC and filesystem work run. */
export function startMainHeartbeatProbe(intervalMs = 25) {
  const gapsMs: number[] = [];
  const stopTimer = startHeartbeatProbe((gapMs) => gapsMs.push(gapMs), intervalMs);
  return {
    snapshot() { return { intervalMs, samples: gapsMs.length, maxGapMs: gapsMs.length ? Math.max(...gapsMs) : null, gapsMs: [...gapsMs] }; },
    stop() { stopTimer(); return this.snapshot(); },
  };
}

/** Install in a renderer context; long tasks and animation frames are separate metrics. */
export function installRendererProbe() {
  const state = {
    longTasks: [] as number[],
    longTaskObserverAvailable: typeof PerformanceObserver !== 'undefined',
    viewerFrames: 0,
    viewerFrameCounterSource: 'explicit markViewerFrame calls after actual viewer render; no animation loop is scheduled',
    previewPhases: [] as Array<{ phase: string; at: number }>,
    firstCommittedBatchAt: null as number | null,
  };
  const observer = typeof PerformanceObserver === 'undefined' ? null : new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
  });
  try { observer?.observe({ type: 'longtask', buffered: true }); } catch { /* Unsupported by this renderer. */ }
  return {
    markViewerFrame() { state.viewerFrames++; },
    markPhase(phase: string) { state.previewPhases.push({ phase, at: performance.now() }); },
    markFirstCommittedBatch() { state.firstCommittedBatchAt ??= performance.now(); },
    snapshot() { return { ...state, longTasks: [...state.longTasks], previewPhases: [...state.previewPhases] }; },
    stop() { observer?.disconnect(); },
  };
}
