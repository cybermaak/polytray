import test from 'node:test';
import assert from 'node:assert/strict';
import { startWatcherThroughMutationGate } from '../../../../src/main/watcherMutationGate';

test('system watcher startup passes the mutation gate to future watcher database writes', async () => {
  const order: string[] = [];
  const runner = async <T>(operation: () => T | Promise<T>): Promise<T> => {
    order.push('gate-enter');
    const result = await operation();
    order.push('gate-exit');
    return result;
  };
  let receivedRunner: typeof runner | undefined;

  await startWatcherThroughMutationGate(async (providedRunner) => {
    receivedRunner = providedRunner as typeof runner;
    order.push('watcher-start');
  }, runner);

  assert.equal(receivedRunner, runner);
  assert.deepEqual(order, ['gate-enter', 'watcher-start', 'gate-exit']);
});
