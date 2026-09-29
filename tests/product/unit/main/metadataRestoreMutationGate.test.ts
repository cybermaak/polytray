import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetadataRestoreLeaseReservation, createMetadataRestoreMutationGate } from '../../../../src/main/metadataRestoreMutationGate';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('restore lease waits for active mutations and replays queued work before releasing', async () => {
  const gate = createMetadataRestoreMutationGate();
  const active = deferred();
  const leaseReady = deferred<() => Promise<void>>();
  const order: string[] = [];
  const first = gate.run(async () => { order.push('active-start'); await active.promise; order.push('active-end'); return 1; });
  const acquire = gate.acquire().then(release => { leaseReady.resolve(release); return release; });
  const queued = gate.run(() => { order.push('queued'); return 2; });

  await Promise.resolve();
  assert.deepEqual(order, ['active-start']);
  active.resolve();
  const release = await leaseReady.promise;
  assert.equal(await first, 1);
  assert.deepEqual(order, ['active-start', 'active-end']);

  let queuedDone = false;
  void queued.then(() => { queuedDone = true; });
  await Promise.resolve();
  assert.equal(queuedDone, false);
  await release();
  assert.equal(await queued, 2);
  assert.deepEqual(order, ['active-start', 'active-end', 'queued']);
  await acquire;
});

test('restore lease reservations serialize renderer lock handshakes before main mutation leases', async () => {
  const reservation = createMetadataRestoreLeaseReservation();
  const first = await reservation.acquire();
  let secondReady = false;
  const secondPromise = reservation.acquire().then(release => { secondReady = true; return release; });
  await Promise.resolve();
  assert.equal(secondReady, false);
  first();
  const second = await secondPromise;
  assert.equal(secondReady, true);
  second();
});
