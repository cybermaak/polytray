import test from 'node:test';
import assert from 'node:assert/strict';

import { createRefreshDebouncer } from '../../../../src/renderer/lib/refreshDebouncer';

test('createRefreshDebouncer coalesces rapid triggers into one refresh', async () => {
  let callCount = 0;
  const debouncer = createRefreshDebouncer(() => {
    callCount += 1;
  }, 25);

  debouncer.trigger();
  debouncer.trigger();
  debouncer.trigger();

  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(callCount, 1);
});

test('createRefreshDebouncer can flush immediately and cancel pending timer', async () => {
  let callCount = 0;
  const debouncer = createRefreshDebouncer(() => {
    callCount += 1;
  }, 50);

  debouncer.trigger();
  debouncer.flush();

  await new Promise((resolve) => setTimeout(resolve, 70));

  assert.equal(callCount, 1);
});

test('createRefreshDebouncer cancel prevents a queued refresh from firing', async () => {
  let callCount = 0;
  const debouncer = createRefreshDebouncer(() => {
    callCount += 1;
  }, 25);

  debouncer.trigger();
  debouncer.cancel();

  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(callCount, 0);
});

test('createRefreshDebouncer coalesces refresh targets without losing independent invalidations', async () => {
  const calls: Array<{ pages: boolean; stats: boolean; topology: boolean }> = [];
  const debouncer = createRefreshDebouncer((targets) => calls.push(targets), 20);

  debouncer.trigger({ pages: true, stats: false, topology: false });
  debouncer.trigger({ pages: false, stats: true, topology: false });
  debouncer.trigger({ pages: false, stats: false, topology: true });
  await new Promise((resolve) => setTimeout(resolve, 45));

  assert.deepEqual(calls, [{ pages: true, stats: true, topology: true }]);
});

test('createRefreshDebouncer cancel discards pending refresh targets', async () => {
  const calls: unknown[] = [];
  const debouncer = createRefreshDebouncer((targets) => calls.push(targets), 20);

  debouncer.trigger({ pages: true, stats: true, topology: true });
  debouncer.cancel();
  await new Promise((resolve) => setTimeout(resolve, 45));

  assert.deepEqual(calls, []);
});

test('createRefreshDebouncer preserves page-only refresh targets', async () => {
  const calls: Array<{ pages: boolean; stats: boolean; topology: boolean }> = [];
  const debouncer = createRefreshDebouncer((targets) => calls.push(targets), 20);

  debouncer.trigger({ pages: true, stats: false, topology: false });
  await new Promise((resolve) => setTimeout(resolve, 45));

  assert.deepEqual(calls, [{ pages: true, stats: false, topology: false }]);
});
