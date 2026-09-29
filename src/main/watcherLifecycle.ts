export interface WatcherProcessLike {
  postMessage(message: unknown): void;
  kill(): void;
  once(event: 'exit', listener: (code: number | null) => void): this;
  on(event: 'exit', listener: (code: number | null) => void): this;
  on(event: 'message', listener: (message: unknown) => void): this;
  removeListener(event: 'exit', listener: (code: number | null) => void): this;
  removeListener(event: 'message', listener: (message: unknown) => void): this;
}

export interface StartWatcherPayload {
  folderPaths: string[];
  watcherStability: number;
}

export interface WatcherFileEvent {
  type: 'add' | 'change' | 'unlink';
  filePath: string;
}

export interface WatcherFileIdentity {
  id: number;
  path: string;
  contentRevision: number;
}

export interface WatcherUpdateCoordinatorOptions<TStat, TMetadata, TIdentity extends WatcherFileIdentity> {
  stat: (filePath: string) => Promise<TStat | null>;
  getIdentity: (filePath: string) => TIdentity | null;
  /** Commit the observed identity before returning it; a null return means no current row. */
  commit: (event: WatcherFileEvent, stat: TStat, current: TIdentity | null) => TIdentity | null;
  remove: (identity: TIdentity) => void;
  isRemovalSafe: (filePath: string) => Promise<boolean>;
  extractMetadata: (identity: TIdentity) => Promise<TMetadata>;
  applyMetadata: (identity: TIdentity, metadata: TMetadata) => boolean | Promise<boolean>;
  generateThumbnail: (identity: TIdentity) => Promise<string | null>;
  applyThumbnail: (identity: TIdentity, thumbnailPath: string | null) => boolean | Promise<boolean>;
  onCommitted?: (event: WatcherFileEvent, identity: TIdentity | null) => void;
}

export function createWatcherNotificationBatcher<T>(publish: (values: T[]) => void, delayMs = 50) {
  const pending = new Map<string, T>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (pending.size === 0) return;
    const values = [...pending.values()];
    pending.clear();
    publish(values);
  }
  return {
    enqueue(key: string, value: T) {
      pending.set(key, value);
      if (!timer) timer = setTimeout(flush, delayMs);
    },
    flush,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending.clear();
    },
  };
}

export interface WatcherRootPollTimer {
  unref?: () => unknown;
}

export function createWatcherRootStatusPoller(
  roots: string[],
  inspectRoot: (rootPath: string) => Promise<void>,
  intervalMs = 500,
  setTimer: (callback: () => void, delayMs: number) => WatcherRootPollTimer = (callback, delay) => setInterval(callback, delay),
  clearTimer: (timer: WatcherRootPollTimer) => void = (timer) => clearInterval(timer as NodeJS.Timeout),
) {
  const configuredRoots = [...new Set(roots)];
  let timer: WatcherRootPollTimer | null = null;
  let checking = false;

  function start() {
    if (timer) return;
    timer = setTimer(() => {
      if (!timer || checking) return;
      checking = true;
      void Promise.all(configuredRoots.map((rootPath) => inspectRoot(rootPath)))
        .catch(() => undefined)
        .finally(() => { checking = false; });
    }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (!timer) return;
    clearTimer(timer);
    timer = null;
  }

  return { start, stop, isRunning: () => timer !== null };
}

export function createWatcherRootAvailabilityTracker() {
  const availability = new Map<string, boolean>();
  return {
    retainConfiguredRoots(roots: string[]) {
      const configured = new Set(roots);
      for (const root of availability.keys()) {
        if (!configured.has(root)) availability.delete(root);
      }
    },
    observe(rootPath: string, available: boolean) {
      const previous = availability.get(rootPath);
      availability.set(rootPath, available);
      return {
        changed: previous !== available,
        recovered: previous === false && available,
      };
    },
  };
}

interface WatcherLifecycleOptions<TProcess extends WatcherProcessLike> {
  createProcess: () => TProcess;
  stopTimeoutMs?: number;
}

interface ActiveWatcher<TProcess extends WatcherProcessLike> {
  process: TProcess;
  token: number;
  onMessage?: (message: unknown) => void;
  onExit?: (code: number | null) => void;
}

const DEFAULT_STOP_TIMEOUT_MS = 2000;

/**
 * Serializes filesystem identity commits per path while allowing expensive
 * enrichment to finish independently. Every enrichment write is fenced by the
 * event generation and the exact indexed file identity/revision it captured.
 */
export function createWatcherUpdateCoordinator<
  TStat,
  TMetadata,
  TIdentity extends WatcherFileIdentity = WatcherFileIdentity,
>(options: WatcherUpdateCoordinatorOptions<TStat, TMetadata, TIdentity>) {
  interface PathState {
    tail: Promise<void>;
    generation: number;
    queued: number;
    enriching: number;
    pendingEvent: WatcherFileEvent | null;
    pendingLifecycle: number;
    pendingWaiters: Array<{ resolve: () => void; reject: (error: unknown) => void }>;
    timer: ReturnType<typeof setTimeout> | null;
  }
  const paths = new Map<string, PathState>();
  const enrichments = new Set<Promise<void>>();
  let nextGeneration = 1;
  let lifecycleGeneration = 1;

  function maybeCleanup(filePath: string, slot: PathState) {
    if (slot.queued !== 0 || slot.enriching !== 0 || slot.pendingEvent || slot.pendingWaiters.length || slot.timer) return;
    const idleGeneration = slot.generation;
    queueMicrotask(() => {
      if (slot.generation === idleGeneration && slot.queued === 0 && slot.enriching === 0 &&
          !slot.pendingEvent && slot.pendingWaiters.length === 0 && !slot.timer && paths.get(filePath) === slot) {
        paths.delete(filePath);
      }
    });
  }

  function isCurrent(filePath: string, identity: TIdentity, generation: number, lifecycle: number) {
    const slot = paths.get(filePath);
    const current = options.getIdentity(filePath);
    return lifecycle === lifecycleGeneration && slot?.generation === generation &&
      current?.id === identity.id && current.path === identity.path &&
      current.contentRevision === identity.contentRevision;
  }

  function trackEnrichment(promise: Promise<void>) {
    let tracked: Promise<void>;
    tracked = promise
      .catch((error: unknown) => {
        try {
          console.warn('[Watcher] Background enrichment failed:', error instanceof Error ? error.message : String(error));
        } catch {
          // Reporting must not turn an expected background failure back into a rejection.
        }
      })
      .finally(() => enrichments.delete(tracked));
    enrichments.add(tracked);
  }

  function startEnrichment(event: WatcherFileEvent, identity: TIdentity, generation: number, lifecycle: number) {
    const slot = paths.get(event.filePath);
    if (!slot) return;
    slot.enriching++;
    const metadata = (async () => {
      try {
        const result = await options.extractMetadata(identity);
        if (!isCurrent(event.filePath, identity, generation, lifecycle)) return;
        await options.applyMetadata(identity, result);
      } catch {
        // Enrichment failure must not undo the already committed file identity.
      }
    })();
    const thumbnail = (async () => {
      let result: string | null;
      try {
        result = await options.generateThumbnail(identity);
      } catch {
        result = null;
      }
      if (!isCurrent(event.filePath, identity, generation, lifecycle)) return;
      await options.applyThumbnail(identity, result);
    })();
    const combined = Promise.all([metadata, thumbnail]).then(() => undefined).finally(() => {
      slot.enriching--;
      maybeCleanup(event.filePath, slot);
    });
    trackEnrichment(combined);
  }

  function coalesce(previous: WatcherFileEvent | null, next: WatcherFileEvent): WatcherFileEvent {
    if (!previous) return next;
    if (next.type === 'unlink') return next;
    if (previous.type === 'unlink' || previous.type === 'change' || next.type === 'change') {
      return { type: 'change', filePath: next.filePath };
    }
    return next;
  }

  function flushPath(filePath: string, slot: PathState) {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    const event = slot.pendingEvent;
    if (!event) {
      maybeCleanup(filePath, slot);
      return;
    }
    const waiters = slot.pendingWaiters.splice(0);
    slot.pendingEvent = null;
    const lifecycle = slot.pendingLifecycle;
    const generation = slot.generation;
    slot.queued++;

    const operation = slot.tail.then(async () => {
      if (lifecycle !== lifecycleGeneration) return;
      if (event.type === 'unlink') {
        if (!await options.isRemovalSafe(event.filePath) || lifecycle !== lifecycleGeneration) return;
        const current = options.getIdentity(event.filePath) as TIdentity | null;
        if (current) options.remove(current);
        options.onCommitted?.(event, null);
        return;
      }

      const stat = await options.stat(event.filePath);
      if (!stat || lifecycle !== lifecycleGeneration) return;
      const current = options.getIdentity(event.filePath) as TIdentity | null;
      const identity = options.commit(event, stat, current);
      if (!identity) return;
      options.onCommitted?.(event, identity);
      if (slot.generation === generation && lifecycle === lifecycleGeneration) {
        startEnrichment(event, identity, generation, lifecycle);
      }
    });
    slot.tail = operation.catch(() => undefined).finally(() => {
      slot.queued--;
      maybeCleanup(filePath, slot);
    });
    void operation.then(() => waiters.forEach(({ resolve }) => resolve()),
      (error) => waiters.forEach(({ reject }) => reject(error)));
  }

  function handle(event: WatcherFileEvent): Promise<void> {
    const lifecycle = lifecycleGeneration;
    let slot = paths.get(event.filePath);
    if (!slot) {
      slot = {
        tail: Promise.resolve(), generation: 0, queued: 0, enriching: 0,
        pendingEvent: null, pendingLifecycle: lifecycle, pendingWaiters: [], timer: null,
      };
      paths.set(event.filePath, slot);
    }
    slot.generation = nextGeneration++;
    slot.pendingEvent = coalesce(slot.pendingEvent, event);
    slot.pendingLifecycle = lifecycle;
    const completion = new Promise<void>((resolve, reject) => slot!.pendingWaiters.push({ resolve, reject }));
    if (slot.pendingEvent.type === 'unlink') {
      flushPath(event.filePath, slot);
    } else {
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = setTimeout(() => flushPath(event.filePath, slot!), 20);
    }
    return completion;
  }

  function invalidatePending() {
    lifecycleGeneration++;
    for (const [filePath, slot] of paths) {
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = null;
      slot.pendingEvent = null;
      for (const waiter of slot.pendingWaiters.splice(0)) waiter.resolve();
      maybeCleanup(filePath, slot);
    }
  }

  async function drain() {
    while (true) {
      for (const [filePath, slot] of paths) {
        if (slot.pendingEvent) flushPath(filePath, slot);
      }
      const pendingPaths = [...paths.entries()].map(([filePath, slot]) => [filePath, slot.tail] as const);
      await Promise.all(pendingPaths.map(([, pending]) => pending));
      const pendingEnrichments = [...enrichments];
      await Promise.all(pendingEnrichments);
      if (enrichments.size === 0 && [...paths.values()].every((slot) => slot.queued === 0 && slot.enriching === 0 && !slot.pendingEvent)) {
        return;
      }
    }
  }

  return {
    handle,
    invalidatePending,
    getTrackedPathCount() { return paths.size; },
    drain,
  };
}

export function createWatcherLifecycleManager<TProcess extends WatcherProcessLike>(
  options: WatcherLifecycleOptions<TProcess>,
) {
  let active: ActiveWatcher<TProcess> | null = null;
  let nextToken = 1;

  function detachListeners(target: ActiveWatcher<TProcess>) {
    if (target.onMessage) {
      target.process.removeListener('message', target.onMessage);
    }
    if (target.onExit) {
      target.process.removeListener('exit', target.onExit);
    }
  }

  function attachHandlers(
    target: ActiveWatcher<TProcess>,
    handlers?: {
      onMessage?: (message: unknown) => void;
      onExit?: (code: number | null) => void;
    },
  ) {
    if (handlers?.onMessage) {
      target.onMessage = handlers.onMessage;
      target.process.on('message', handlers.onMessage);
    }

    const exitHandler = (code: number | null) => {
      detachListeners(target);
      if (active?.token === target.token) {
        active = null;
      }
      handlers?.onExit?.(code);
    };

    target.onExit = exitHandler;
    target.process.on('exit', exitHandler);
  }

  function start(
    payload: StartWatcherPayload,
    handlers?: {
      onMessage?: (message: unknown) => void;
      onExit?: (code: number | null) => void;
    },
  ) {
    const process = options.createProcess();
    const target: ActiveWatcher<TProcess> = {
      process,
      token: nextToken++,
    };

    attachHandlers(target, handlers);
    active = target;
    process.postMessage({
      type: 'start',
      folderPaths: payload.folderPaths,
      watcherStability: payload.watcherStability,
    });
    return process;
  }

  async function stop() {
    if (!active) {
      return;
    }

    const target = active;
    active = null;

    await new Promise<void>((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        target.process.kill();
        resolve();
      }, options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);

      const onExit = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        target.process.removeListener('exit', onExit);
        resolve();
      };

      target.process.once('exit', onExit);
      target.process.postMessage({ type: 'stop' });
    });
  }

  async function restart(
    payload: StartWatcherPayload,
    handlers?: {
      onMessage?: (message: unknown) => void;
      onExit?: (code: number | null) => void;
    },
  ) {
    await stop();
    return start(payload, handlers);
  }

  return {
    start,
    stop,
    restart,
    getCurrentProcess() {
      return active?.process ?? null;
    },
  };
}
