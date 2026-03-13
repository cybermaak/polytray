import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createWatcherLifecycleManager } from '../../../../src/main/watcherLifecycle';

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
