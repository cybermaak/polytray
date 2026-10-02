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

function held() { const signal = deferred(); return { promise: signal.promise, release: signal.resolve }; }
const pendingAfterTurn = () => new Promise<string>(resolve => setImmediate(() => resolve('pending')));
test('restore admission promptly rejects a still-active paused scan', async () => {
  const gate = createMetadataRestoreMutationGate();
  const pause = held();
  const scan = gate.run(() => pause.promise, { kind: 'scan' });
  const lease = gate.acquire({ excludeScans: true });
  const result = await Promise.race([lease.then(() => 'acquired', () => 'rejected'), pendingAfterTurn()]);
  try { assert.equal(result, 'rejected'); assert.equal(gate.isLocked(), false); }
  finally { pause.release(); await scan; const release = await lease.catch(() => null); await release?.(); }
});
test('a scan racing behind restore admission rejects instead of queuing', async () => {
  const gate = createMetadataRestoreMutationGate();
  const release = await gate.acquire({ excludeScans: true });
  let started = false;
  const scan = gate.run(() => { started = true; }, { kind: 'scan' });
  const result = await Promise.race([scan.then(() => 'ran', () => 'rejected'), pendingAfterTurn()]);
  try { assert.equal(result, 'rejected'); assert.equal(started, false); }
  finally { await release(); await scan.catch(() => undefined); }
});

test('a scan attempt during renderer admission invalidates restore before any write', async () => {
  const gate = createMetadataRestoreMutationGate();
  const reservation = createMetadataRestoreLeaseReservation();
  const releaseReservation = await reservation.acquire();
  const revision = gate.getScanAttemptRevision();
  const releaseGate = await gate.acquire({ excludeScans: true });
  let writes = 0;
  try {
    await assert.rejects(gate.run(() => { writes++; }, { kind: 'scan' }));
    assert.throws(() => gate.assertScanAdmissionUnchanged(revision), /Finish or cancel active scans/);
    assert.equal(writes, 0);
  } finally { await releaseGate(); releaseReservation(); }
  const nextReservation = await reservation.acquire();
  const nextGate = await gate.acquire({ excludeScans: true });
  await nextGate(); nextReservation();
  assert.equal(gate.isLocked(), false);
});
test('scan retry remains excluded until its complete promise settles', async () => {
  const gate = createMetadataRestoreMutationGate();
  const retry = deferred();
  const work = gate.run(() => retry.promise, { kind: 'scan' });
  await assert.rejects(gate.acquire({ excludeScans: true }), /Finish or cancel active scans/);
  retry.resolve(); await work;
  const release = await gate.acquire({ excludeScans: true });
  await release();
});
