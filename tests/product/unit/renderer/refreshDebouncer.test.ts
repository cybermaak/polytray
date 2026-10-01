import test from 'node:test';
import assert from 'node:assert/strict';

import { createRefreshDebouncer } from '../../../../src/renderer/lib/refreshDebouncer';

// Mock timers make the debounce deterministic: real sleeps of 45-70ms against 20-50ms delays
// could fail on a loaded CI runner when the debounce timer fired late.

test('createRefreshDebouncer coalesces rapid triggers into one refresh', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let callCount = 0;
  const debouncer = createRefreshDebouncer(() => {
    callCount += 1;
  }, 25);

  debouncer.trigger();
  debouncer.trigger();
  debouncer.trigger();

  t.mock.timers.tick(24);
  assert.equal(callCount, 0, 'does not refresh before the delay elapses');
  t.mock.timers.tick(1);
  assert.equal(callCount, 1);
  t.mock.timers.tick(100);
  assert.equal(callCount, 1);
});

test('createRefreshDebouncer can flush immediately and cancel pending timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let callCount = 0;
  const debouncer = createRefreshDebouncer(() => {
    callCount += 1;
  }, 50);

  debouncer.trigger();
  debouncer.flush();
  assert.equal(callCount, 1);

  t.mock.timers.tick(100);
  assert.equal(callCount, 1);
});

test('createRefreshDebouncer cancel prevents a queued refresh from firing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let callCount = 0;
  const debouncer = createRefreshDebouncer(() => {
    callCount += 1;
  }, 25);

  debouncer.trigger();
  debouncer.cancel();

  t.mock.timers.tick(100);
  assert.equal(callCount, 0);
});

test('createRefreshDebouncer coalesces refresh targets without losing independent invalidations', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: Array<{ pages: boolean; stats: boolean; topology: boolean }> = [];
  const debouncer = createRefreshDebouncer((targets) => calls.push(targets), 20);

  debouncer.trigger({ pages: true, stats: false, topology: false });
  debouncer.trigger({ pages: false, stats: true, topology: false });
  debouncer.trigger({ pages: false, stats: false, topology: true });
  t.mock.timers.tick(20);

  assert.deepEqual(calls, [{ pages: true, stats: true, topology: true }]);
});

test('createRefreshDebouncer cancel discards pending refresh targets', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: unknown[] = [];
  const debouncer = createRefreshDebouncer((targets) => calls.push(targets), 20);

  debouncer.trigger({ pages: true, stats: true, topology: true });
  debouncer.cancel();
  t.mock.timers.tick(100);

  assert.deepEqual(calls, []);
});

test('createRefreshDebouncer preserves page-only refresh targets', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: Array<{ pages: boolean; stats: boolean; topology: boolean }> = [];
  const debouncer = createRefreshDebouncer((targets) => calls.push(targets), 20);

  debouncer.trigger({ pages: true, stats: false, topology: false });
  t.mock.timers.tick(20);

  assert.deepEqual(calls, [{ pages: true, stats: false, topology: false }]);
});
