import assert from 'node:assert/strict';
import test from 'node:test';

import { createBarrier, createScenarioGates, installRendererProbe } from '../helpers/performanceProbe';

test('barriers allow deterministic out-of-order completion without timers', async () => {
  const first = createBarrier<number>();
  const second = createBarrier<number>();
  const firstWork = first.wait();
  const secondWork = second.wait();
  await Promise.all([first.reached, second.reached]);
  second.release(2);
  assert.equal(await secondWork, 2);
  first.release(1);
  assert.equal(await firstWork, 1);
});

test('scenario gates expose independent subtree, failure, parse, extraction, and cancellation controls', () => {
  const gates = createScenarioGates();
  assert.equal(gates.cancellation.signal.aborted, false);
  gates.cancellation.abort();
  assert.equal(gates.cancellation.signal.aborted, true);
  assert.notEqual(gates.subtreeDiscovery, gates.parsing);
  assert.notEqual(gates.parsing, gates.extraction);
});

test('cancel before waiting rejects without an unhandled promise and removes abort listeners after settlement', async () => {
  const beforeWait = createBarrier<number>();
  beforeWait.cancel(new Error('cancelled early'));
  await assert.rejects(beforeWait.wait(), /cancelled early/);

  const barrier = createBarrier<number>();
  let listeners = 0;
  const signal = {
    aborted: false,
    reason: undefined,
    addEventListener() { listeners++; },
    removeEventListener() { listeners--; },
  } as unknown as AbortSignal;
  const waiting = barrier.wait(signal);
  await barrier.reached;
  barrier.release(3);
  assert.equal(await waiting, 3);
  assert.equal(listeners, 0);
});

test('renderer probe counts only explicitly marked viewer renders', () => {
  const probe = installRendererProbe();
  try {
    probe.markViewerFrame();
    probe.markViewerFrame();
    assert.equal(probe.snapshot().viewerFrames, 2);
  } finally { probe.stop(); }
});
