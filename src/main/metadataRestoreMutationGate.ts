type QueuedMutation = () => Promise<void>;

/** Serializes renderer-lock handshakes before any lease closes the main gate. */
export function createMetadataRestoreLeaseReservation() {
  let tail: Promise<void> = Promise.resolve();
  return {
    async acquire(): Promise<() => void> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release();
      };
    },
  };
}

/**
 * Stops new main-process mutations while a restore spans SQLite and renderer
 * localStorage. Mutations already in progress drain before the lease is granted;
 * queued work replays serially when the lease is released.
 */
export function createMetadataRestoreMutationGate() {
  let locked = false;
  let active = 0;
  let idleWaiters: Array<() => void> = [];
  const queued: QueuedMutation[] = [];

  function runActive<T>(operation: () => T | Promise<T>): Promise<T> {
    active++;
    return Promise.resolve()
      .then(operation)
      .finally(() => {
        active--;
        if (active === 0) {
          const waiters = idleWaiters;
          idleWaiters = [];
          for (const resolve of waiters) resolve();
        }
      });
  }

  function run<T>(operation: () => T | Promise<T>): Promise<T> {
    if (!locked) return runActive(operation);
    return new Promise<T>((resolve, reject) => {
      queued.push(async () => {
        try { resolve(await runActive(operation)); }
        catch (error) { reject(error); }
      });
    });
  }

  async function acquire(): Promise<() => Promise<void>> {
    if (locked) throw new Error('A metadata restore mutation lease is already active');
    locked = true;
    if (active > 0) await new Promise<void>(resolve => idleWaiters.push(resolve));
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        while (queued.length > 0) {
          const mutation = queued.shift()!;
          await mutation();
        }
      } finally {
        locked = false;
      }
    };
  }

  return { run, acquire, isLocked: () => locked };
}
