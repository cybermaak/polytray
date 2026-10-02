type QueuedRendererMutation = () => Promise<void>;

/** Defers renderer-owned mutations while a metadata restore owns localStorage. */
export function createRendererMutationGate() {
  let locked = false;
  let draining = false;
  let active = 0;
  let idleWaiters: Array<() => void> = [];
  const queued: QueuedRendererMutation[] = [];

  function runActive<T>(operation: () => T | Promise<T>): Promise<T> {
    active++;
    return Promise.resolve().then(operation).finally(() => {
      active--;
      if (active === 0) {
        const waiters = idleWaiters;
        idleWaiters = [];
        waiters.forEach(resolve => resolve());
      }
    });
  }

  function run<T>(operation: () => T | Promise<T>): Promise<T> {
    if (!locked && !draining) return runActive(operation);
    return new Promise<T>((resolve, reject) => {
      queued.push(async () => {
        try { resolve(await runActive(operation)); }
        catch (error) { reject(error); }
      });
    });
  }

  async function lock(options: { requireIdle?: boolean } = {}): Promise<void> {
    if (options.requireIdle && (active > 0 || draining)) throw new Error('Finish current library changes before applying this import.');
    if (locked) return;
    locked = true;
    if (active > 0) await new Promise<void>(resolve => idleWaiters.push(resolve));
  }

  async function unlock(): Promise<void> {
    if (!locked) return;
    locked = false;
    draining = true;
    try {
      while (queued.length > 0) await queued.shift()!();
    } finally {
      draining = false;
    }
  }

  return { run, lock, unlock, isLocked: () => locked || draining };
}
