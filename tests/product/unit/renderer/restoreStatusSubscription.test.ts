import assert from 'node:assert/strict';
import test from 'node:test';
import { subscribeToRestoreStatusRefresh } from '../../../../src/renderer/lib/restoreStatusSubscription';

test('restore status refresh unsubscribes when its owning panel closes', () => {
  const listeners = new Set<() => void>();
  let refreshes = 0;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const publish = () => [...listeners].forEach(listener => listener());
  const stop = subscribeToRestoreStatusRefresh(subscribe, () => { refreshes += 1; });

  publish();
  assert.equal(refreshes, 1);
  stop();
  publish();
  assert.equal(refreshes, 1);
});
