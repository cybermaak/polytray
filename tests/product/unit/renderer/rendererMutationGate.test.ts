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
