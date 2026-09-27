import type { CommittedFileMutation } from './fileIndexing';

export interface LibraryMutationPublisherOptions {
  send: (mutation: CommittedFileMutation) => void;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  minimumIntervalMs?: number;
}

export interface LibraryMutationPublisher {
  publish(mutation: CommittedFileMutation): void;
  flush(): void;
  dispose(): void;
}

function mergeMutations(left: CommittedFileMutation, right: CommittedFileMutation): CommittedFileMutation {
  return {
    affectedPaths: [...new Set([...left.affectedPaths, ...right.affectedPaths])],
    paths: [...new Set([...left.paths, ...right.paths])],
    rowsChanged: left.rowsChanged || right.rowsChanged,
    annotationsChanged: left.annotationsChanged || right.annotationsChanged,
    statsChanged: left.statsChanged || right.statsChanged,
    topologyChanged: left.topologyChanged || right.topologyChanged,
    thumbnailOnly: left.thumbnailOnly && right.thumbnailOnly,
    browseRevision: Math.max(left.browseRevision, right.browseRevision),
  };
}

export function createLibraryMutationPublisher(
  options: LibraryMutationPublisherOptions,
): LibraryMutationPublisher {
  const minimumIntervalMs = Math.max(250, Math.floor(options.minimumIntervalMs ?? 250));
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let lastPublishedAt: number | null = null;
  let pending: CommittedFileMutation | null = null;
  let timer: unknown | null = null;
  let disposed = false;

  function deliver(mutation: CommittedFileMutation) {
    try {
      const result = options.send(mutation) as unknown;
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        void Promise.resolve(result).catch((error: unknown) => {
          console.error('[FileIndex] Library mutation send rejected:', error);
        });
      }
    } catch (error) {
      console.error('[FileIndex] Library mutation send failed:', error);
    }
  }

  function publishPending() {
    timer = null;
    if (!pending || disposed) return;
    const mutation = pending;
    pending = null;
    lastPublishedAt = now();
    deliver(mutation);
  }

  function scheduleFlush() {
    if (timer !== null || !pending || disposed) return;
    const elapsed = lastPublishedAt === null ? minimumIntervalMs : now() - lastPublishedAt;
    const delay = Math.max(0, minimumIntervalMs - elapsed);
    timer = setTimer(publishPending, delay);
  }

  return {
    publish(mutation) {
      if (disposed) return;
      const due = lastPublishedAt === null || now() - lastPublishedAt >= minimumIntervalMs;
      if (pending && due) {
        pending = mergeMutations(pending, mutation);
        if (timer !== null) clearTimer(timer);
        publishPending();
        return;
      }
      if (!pending && due) {
        lastPublishedAt = now();
        deliver(mutation);
        return;
      }
      pending = pending ? mergeMutations(pending, mutation) : mutation;
      scheduleFlush();
    },
    flush() {
      if (disposed || !pending) return;
      if (timer !== null) clearTimer(timer);
      publishPending();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      pending = null;
    },
  };
}
