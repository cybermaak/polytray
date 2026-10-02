import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ElectronApplication } from 'playwright';
import { installShutdownEvidence } from '../../support/helpers/shutdownEvidence';

const missingOutput = () => path.join(os.tmpdir(), `polytray-missing-probe-${randomUUID()}`, 'shutdown.jsonl');

test('failed probe installation still permits the awaited app close', async () => {
  const app = {
    evaluate: async () => { throw new Error('diagnostic installation failed'); },
    process: () => ({ pid: process.pid }),
  } as unknown as ElectronApplication;
  let closed = false;
  const closeWithEvidence = await installShutdownEvidence(app, missingOutput());
  await closeWithEvidence(async () => { closed = true; });
  assert.equal(closed, true);
});

test('unwritable evidence output cannot skip the awaited app close', async () => {
  const app = {
    evaluate: async () => undefined,
    process: () => ({ pid: process.pid }),
  } as unknown as ElectronApplication;
  let closed = false;
  const closeWithEvidence = await installShutdownEvidence(app, missingOutput());
  await closeWithEvidence(async () => { closed = true; });
  assert.equal(closed, true);
});
