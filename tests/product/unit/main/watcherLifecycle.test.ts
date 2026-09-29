import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createMetadataRestoreWatcherResumePlan, createSerializedTransitionQueue, createWatcherLifecycleManager, handleCurrentWatcherExit, runWithWatcherStartRollback } from '../../../../src/main/watcherLifecycle';

class FakeWorker extends EventEmitter {
  public postMessages: unknown[] = [];
  public killCalls = 0;

  postMessage(message: unknown) {
    this.postMessages.push(message);
  }

  kill() {
    this.killCalls += 1;
    this.emit('exit', null);
  }
}

test('restore watcher release uses only restored roots and enabled watch/scan preferences', () => {
  assert.deepEqual(createMetadataRestoreWatcherResumePlan(['/restored'], { watch: false, autoScan: false }), {
    watchRoots: [], scanRoots: [],
  });
  assert.deepEqual(createMetadataRestoreWatcherResumePlan(['/restored'], { watch: true, autoScan: false }), {
    watchRoots: ['/restored'], scanRoots: [],
  });
  assert.deepEqual(createMetadataRestoreWatcherResumePlan(['/restored'], { watch: false, autoScan: true }), {
    watchRoots: [], scanRoots: ['/restored'],
  });
});

test('stop sends stop message and waits for exit', async () => {
  const worker = new FakeWorker();
  const manager = createWatcherLifecycleManager({
    createProcess: () => worker,
    stopTimeoutMs: 20,
  });

  manager.start({ folderPaths: ['/models'], watcherStability: 1000 });
  const stopPromise = manager.stop();

  assert.deepEqual(worker.postMessages, [
    { type: 'start', folderPaths: ['/models'], watcherStability: 1000 },
    { type: 'stop' },
  ]);

  worker.emit('exit', 0);
  await stopPromise;

  assert.equal(worker.killCalls, 0);
  assert.equal(manager.getCurrentProcess(), null);
});

test('stop force-kills worker when exit timeout is reached', async () => {
  const worker = new FakeWorker();
  const manager = createWatcherLifecycleManager({
    createProcess: () => worker,
    stopTimeoutMs: 5,
  });

  manager.start({ folderPaths: ['/models'], watcherStability: 1000 });
  await manager.stop();

  assert.equal(worker.killCalls, 1);
  assert.equal(manager.getCurrentProcess(), null);
});

test('restarting watcher detaches stale process cleanup from the new worker', async () => {
  const workers = [new FakeWorker(), new FakeWorker()];
  let index = 0;
  const manager = createWatcherLifecycleManager({
    createProcess: () => workers[index++],
    stopTimeoutMs: 20,
  });

  const first = manager.start({ folderPaths: ['/a'], watcherStability: 1000 });
  const restartPromise = manager.restart({ folderPaths: ['/b'], watcherStability: 500 });

  assert.equal(manager.getCurrentProcess(), null);
  first.emit('exit', 0);
  const second = await restartPromise;

  assert.equal(second, workers[1]);
  assert.equal(manager.getCurrentProcess(), second);

  first.emit('exit', 0);
  assert.equal(manager.getCurrentProcess(), second);
});

test('watcher lifecycle transitions run in request order and do not overlap', async () => {
  const runTransition = createSerializedTransitionQueue();
  const order: string[] = [];
  let releaseFirst!: () => void;
  const firstBarrier = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const first = runTransition(async () => {
    order.push('start-enter');
    await firstBarrier;
    order.push('start-exit');
  });
  const stop = runTransition(async () => { order.push('stop'); });
  const reconfigure = runTransition(async () => { order.push('reconfigure'); });

  await Promise.resolve();
  assert.deepEqual(order, ['start-enter']);
  releaseFirst();
  await Promise.all([first, stop, reconfigure]);
  assert.deepEqual(order, ['start-enter', 'start-exit', 'stop', 'reconfigure']);
});

test('failed watcher start rolls back caller-owned context and leaves no worker', async () => {
  const manager = createWatcherLifecycleManager({
    createProcess: () => { throw new Error('utility process launch failed'); },
  });
  let context: { root: string } | null = { root: '/models' };
  await assert.rejects(
    runWithWatcherStartRollback(
      () => manager.restart({ folderPaths: ['/models'], watcherStability: 100 }),
      () => { context = null; },
    ),
    /utility process launch failed/,
  );
  assert.equal(manager.getCurrentProcess(), null);
  assert.equal(context, null);
});

test('unexpected current worker exit clears context while expected stop exit stays silent', async () => {
  const worker = new FakeWorker();
  const manager = createWatcherLifecycleManager({ createProcess: () => worker });
  let currentRun = 1;
  let context: { root: string } | null = { root: '/models' };
  const errors: Array<{ root: string; code: number | null }> = [];
  manager.start({ folderPaths: ['/models'], watcherStability: 100 }, {
    onExit: (code) => {
      handleCurrentWatcherExit(1, currentRun, context, code, (active, exitCode) => {
        errors.push({ root: active.root, code: exitCode });
        context = null;
      });
    },
  });
  worker.emit('exit', 9);
  assert.equal(manager.getCurrentProcess(), null);
  assert.equal(context, null);
  assert.deepEqual(errors, [{ root: '/models', code: 9 }]);

  const expectedWorker = new FakeWorker();
  const expectedManager = createWatcherLifecycleManager({ createProcess: () => expectedWorker });
  let expectedContext: { root: string } | null = { root: '/models' };
  const expectedErrors: number[] = [];
  expectedManager.start({ folderPaths: ['/models'], watcherStability: 100 }, {
    onExit: (code) => {
      handleCurrentWatcherExit(1, currentRun, expectedContext, code, (_active, exitCode) => {
        expectedErrors.push(exitCode ?? -1);
        expectedContext = null;
      });
    },
  });
  currentRun = 2;
  const stopping = expectedManager.stop();
  expectedWorker.emit('exit', 0);
  await stopping;
  expectedContext = null;
  assert.equal(expectedContext, null);
  assert.deepEqual(expectedErrors, []);
});
