import type { Database } from 'better-sqlite3';
import { backfillFileScopes, isScopeBackfillComplete } from './fileScopes';
import { subscribeToFileIndexMutations, type CommittedFileMutation } from './fileIndexing';

export type FileIndexRuntimeStatus = 'idle' | 'backfilling' | 'ready' | 'failed' | 'disposed';

export interface FileIndexRuntimeProgress {
  status: FileIndexRuntimeStatus;
  cursorFileId: number;
  processedThisBatch: number;
  processedTotal: number;
  complete: boolean;
  error?: string;
}

export interface FileIndexRuntimeOptions {
  batchSize?: number;
  onMutation?: (mutation: CommittedFileMutation) => void;
  onProgress?: (progress: FileIndexRuntimeProgress) => void;
  yieldToEventLoop?: (signal: AbortSignal) => Promise<void>;
}

export interface FileIndexRuntime {
  startBackfill(): Promise<void>;
  canUseScopeReader(): boolean;
  getProgress(): FileIndexRuntimeProgress;
  dispose(): Promise<void>;
}

function defaultYieldToEventLoop(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const immediate = setImmediate(finish);
    const onAbort = () => {
      clearImmediate(immediate);
      finish();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function createFileIndexRuntime(
  db: Database,
  options: FileIndexRuntimeOptions = {},
): FileIndexRuntime {
  const controller = new AbortController();
  const unsubscribe = subscribeToFileIndexMutations(db, options.onMutation ?? (() => {}));
  const batchSize = Math.max(1, Math.min(2000, Math.floor(options.batchSize ?? 250)));
  let progress: FileIndexRuntimeProgress = {
    status: 'idle', cursorFileId: 0, processedThisBatch: 0, processedTotal: 0, complete: false,
  };
  let running: Promise<void> | null = null;
  let disposed = false;

  function publish(next: FileIndexRuntimeProgress) {
    progress = next;
    options.onProgress?.({ ...next });
  }

  async function waitForYield() {
    const pendingYield = (options.yieldToEventLoop ?? defaultYieldToEventLoop)(controller.signal);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        controller.signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        controller.signal.removeEventListener('abort', onAbort);
        reject(error);
      };
      const onAbort = () => finish();
      if (controller.signal.aborted) return finish();
      controller.signal.addEventListener('abort', onAbort, { once: true });
      pendingYield.then(finish, fail);
    });
  }

  async function runBackfill() {
    let processedTotal = 0;
    let cursorFileId = progress.cursorFileId;
    try {
      if (isScopeBackfillComplete(db)) {
        publish({ status: 'ready', cursorFileId, processedThisBatch: 0, processedTotal, complete: true });
        return;
      }
      publish({ status: 'backfilling', cursorFileId, processedThisBatch: 0, processedTotal, complete: false });
      while (!controller.signal.aborted) {
        const page = backfillFileScopes(db, batchSize);
        processedTotal += page.processed;
        cursorFileId = page.cursorFileId;
        if (page.complete) {
          publish({ status: 'ready', cursorFileId, processedThisBatch: page.processed, processedTotal, complete: true });
          return;
        }
        publish({ status: 'backfilling', cursorFileId, processedThisBatch: page.processed, processedTotal, complete: false });
        await waitForYield();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      publish({ status: 'failed', cursorFileId, processedThisBatch: 0, processedTotal, complete: false, error: message });
      throw error;
    }
  }

  function startBackfill(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (running) return running;
    if (progress.status === 'ready') {
      publish({ ...progress, status: 'ready', complete: true });
      return Promise.resolve();
    }
    running = runBackfill().finally(() => { running = null; });
    return running;
  }

  return {
    startBackfill,
    canUseScopeReader: () => {
      try { return isScopeBackfillComplete(db); } catch { return false; }
    },
    getProgress: () => ({ ...progress }),
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      controller.abort();
      try { await running; } catch { /* Failure was already reported by the backfill task. */ }
      publish({ ...progress, status: 'disposed' });
    },
  };
}
