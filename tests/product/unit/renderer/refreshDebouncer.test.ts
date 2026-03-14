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
