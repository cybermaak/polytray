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
