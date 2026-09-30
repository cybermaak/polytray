import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import * as isolatedApp from '../../support/helpers/isolatedApp';

function fakeProcess(onKill: (signal: NodeJS.Signals, exit: () => void) => void) {
  const events = new EventEmitter() as EventEmitter & { exitCode: number | null; kill: (signal: NodeJS.Signals) => boolean };
  events.exitCode = null;
  events.kill = (signal) => {
    onKill(signal, () => { events.exitCode = 0; events.emit('exit', 0, null); });
    return true;
  };
  return events as unknown as ChildProcess;
}

test('timed-out isolated app cleanup waits for its process exit before removing private files', async () => {
  const cleanup = (isolatedApp as any).cleanupTimedOutIsolatedApp;
  assert.equal(typeof cleanup, 'function');
  const signals: NodeJS.Signals[] = [];
  const child = fakeProcess((signal, exit) => { signals.push(signal); setTimeout(exit, 5); });
  let removed = false;
  await cleanup(child, '/private/polytray-isolated-test', {
    termWaitMs: 50, killWaitMs: 50,
    removeOwnedDir: () => { assert.notEqual(child.exitCode, null); removed = true; },
  });
  assert.equal(removed, true);
  assert.deepEqual(signals, ['SIGTERM']);
});

test('timed-out isolated app cleanup escalates only its process and retains files if exit is unconfirmed', async () => {
  const cleanup = (isolatedApp as any).cleanupTimedOutIsolatedApp;
  assert.equal(typeof cleanup, 'function');
  const signals: NodeJS.Signals[] = [];
  const child = fakeProcess((signal) => { signals.push(signal); });
  let removed = false;
  await assert.rejects(cleanup(child, '/private/polytray-isolated-test', {
    termWaitMs: 5, killWaitMs: 5,
    removeOwnedDir: () => { removed = true; },
  }), /did not exit/);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(removed, false);
});

test('timed-out isolated app cleanup rejects a directory it does not own', async () => {
  const cleanup = (isolatedApp as any).cleanupTimedOutIsolatedApp;
  assert.equal(typeof cleanup, 'function');
  const signals: NodeJS.Signals[] = [];
  const child = fakeProcess((signal) => { signals.push(signal); });
  let removed = false;
  await assert.rejects(cleanup(child, '/private/unrelated', {
    termWaitMs: 5, killWaitMs: 5,
    removeOwnedDir: () => { removed = true; },
  }), /isolated owner/);
  assert.deepEqual(signals, []);
  assert.equal(removed, false);
});

test('cleanup failure cannot replace an earlier test assertion', async () => {
  const preserve = (isolatedApp as any).cleanupPreservingPrimaryFailure;
  assert.equal(typeof preserve, 'function');
  const cleanupError = new Error('private database remains locked');
  const recorded: unknown[] = [];
  await preserve(true, async () => { throw cleanupError; }, (error: unknown) => { recorded.push(error); });
  assert.deepEqual(recorded, [cleanupError]);
});

test('cleanup failure remains visible when the test body passed', async () => {
  const preserve = (isolatedApp as any).cleanupPreservingPrimaryFailure;
  assert.equal(typeof preserve, 'function');
  const cleanupError = new Error('private database remains locked');
  await assert.rejects(preserve(false, async () => { throw cleanupError; }, () => {}),
    (error: unknown) => error === cleanupError);
});

test('an early app-close rejection still waits for owned process exit before deleting scratch', async () => {
  const close = (isolatedApp as any).closeIsolatedAppWithFallback;
  assert.equal(typeof close, 'function');
  const signals: NodeJS.Signals[] = [];
  const child = fakeProcess((signal, exit) => { signals.push(signal); setTimeout(exit, 5); });
  let removed = false;
  const fakeApp = {
    app: { process: () => child },
    userDataDir: '/private/polytray-isolated-test/user-data',
    close: async () => { throw new Error('app close rejected while process was alive'); },
  };
  await close(fakeApp, {
    closeWaitMs: 50, termWaitMs: 50, killWaitMs: 50,
    removeOwnedDir: () => { assert.notEqual(child.exitCode, null); removed = true; },
  });
  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal(removed, true);
});
