import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererMutationGate } from '../../../../src/renderer/rendererMutationGate';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('renderer state mutations drain before lock and replay in order after unlock', async () => {
  const gate = createRendererMutationGate();
  const active = deferred();
  const order: string[] = [];
  const first = gate.run(async () => { order.push('active-start'); await active.promise; order.push('active-end'); });
  const locking = gate.lock();
  const queued = gate.run(() => { order.push('queued'); });
  await Promise.resolve();
  assert.deepEqual(order, ['active-start']);
  active.resolve();
  await locking;
  assert.deepEqual(order, ['active-start', 'active-end']);
  assert.equal(gate.isLocked(), true);

  const unlocking = gate.unlock();
  await Promise.all([first, queued, unlocking]);
  assert.deepEqual(order, ['active-start', 'active-end', 'queued']);
  assert.equal(gate.isLocked(), false);
});

function held() { const signal = deferred(); return { promise: signal.promise, release: signal.resolve }; }
const pendingAfterTurn = () => new Promise<string>(resolve => setImmediate(() => resolve('pending')));
test('renderer admission rejects an initial-add operation without locking controls', async () => {
  const gate = createRendererMutationGate();
  const selectAndScan = held();
  const add = gate.run(() => selectAndScan.promise);
  const lock = gate.lock({ requireIdle: true });
  const result = await Promise.race([lock.then(() => 'locked', () => 'rejected'), pendingAfterTurn()]);
  try { assert.equal(result, 'rejected'); assert.equal(gate.isLocked(), false); }
  finally { selectAndScan.release(); await add; await lock.catch(() => undefined); await gate.unlock(); }
});
