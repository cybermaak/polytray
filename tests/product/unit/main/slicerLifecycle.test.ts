import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startSlicerStartupCleanup } from '../../../../src/main/ipc/slicer';

test('installs lifecycle hooks before held cleanup and keeps shutdown disposal usable', async () => {
  const events = new EventEmitter();
  let release!: () => void;
  const cleanupHold = new Promise<void>(resolve => { release = resolve; });
  let cleanupStarted = false;
  let disposed = false;
  startSlicerStartupCleanup(
    () => { events.once('will-quit', () => { disposed = true; }); events.on('activate', () => {}); },
    () => { cleanupStarted = true; return cleanupHold; },
    () => assert.fail('held cleanup must not fail'),
  );
  assert.equal(events.listenerCount('will-quit'), 1);
  assert.equal(events.listenerCount('activate'), 1);
  assert.equal(cleanupStarted, true);
  events.emit('will-quit');
  assert.equal(disposed, true);
  release();
  await cleanupHold;
});

test('reports cleanup rejection without blocking startup or removing lifecycle hooks', async () => {
  const events = new EventEmitter();
  let disposed = false;
  let reported = 0;
  startSlicerStartupCleanup(
    () => events.once('will-quit', () => { disposed = true; }),
    async () => { throw new Error('cannot delete stale handoff file'); },
    () => { reported += 1; },
  );
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reported, 1);
  assert.equal(events.listenerCount('will-quit'), 1);
  events.emit('will-quit');
  assert.equal(disposed, true);
});
