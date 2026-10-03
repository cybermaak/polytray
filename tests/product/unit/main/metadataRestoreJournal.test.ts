import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMetadataRestoreJournal, type MetadataRestoreJournalRecord } from '../../../../src/main/metadataRestoreJournal';

const record: MetadataRestoreJournalRecord = {
  transactionId: 'restore-1', state: 'prepared', createdAt: '2026-09-28T00:00:00.000Z',
  recoveryBackupPath: '/tmp/recovery.json', before: { roots: ['/before'], collections: [], settings: { theme: 'dark' } },
  after: { roots: ['/after'], collections: [], settings: { theme: 'light' } },
  plan: { transactionId: 'restore-1', inputRevision: 'revision', currentBrowseRevision: 0, currentRendererRevision: 4,
    matchedAnnotationCount: 0, changedAnnotationCount: 0, pendingAnnotationCount: 0, conflictCount: 0,
    unmatchedPaths: [], annotationUpdates: [], pendingAnnotationUpdates: [], changedAnnotationUpdates: [], unchangedAnnotationUpdates: [],
    indexedIdentityExpectations: [],
    annotationConflicts: [], collectionIdRemaps: [], collectionsBefore: [], collectionsAfter: [], settingsBefore: {}, settingsAfter: {},
    rootsBefore: [], rootsAfter: [], replaceSettings: false, replaceRoots: false },
};

test('journal persists each restore transition atomically and can enumerate interrupted records', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-journal-'));
  try {
    const journal = createMetadataRestoreJournal(dir);
    await journal.write(record);
    await journal.write({ ...record, state: 'database-applied' });
    assert.deepEqual(await journal.read('restore-1'), { ...record, state: 'database-applied' });
    assert.deepEqual(await journal.readPending(), [{ ...record, state: 'database-applied' }]);
    assert.equal((await fs.promises.readdir(dir)).some(name => name.endsWith('.tmp')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('journal rejects corrupt records without deleting recovery evidence', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-corrupt-'));
  try {
    await fs.promises.writeFile(path.join(dir, 'restore-1.json'), '{broken');
    const journal = createMetadataRestoreJournal(dir);
    await assert.rejects(journal.readPending(), /corrupt|invalid/i);
    assert.equal(fs.existsSync(path.join(dir, 'restore-1.json')), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('journal rejects structurally incomplete JSON records and retains the evidence file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-invalid-journal-'));
  const file = path.join(dir, 'restore-1.json');
  try {
    await fs.promises.writeFile(file, JSON.stringify({ ...record, before: { ...record.before, roots: 'not-an-array' },
      plan: { ...record.plan, annotationUpdates: undefined } }));
    await assert.rejects(createMetadataRestoreJournal(dir).readPending(), /corrupt|invalid/i);
    assert.equal(fs.existsSync(file), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('journal replacement retries transient Windows rename locks', async () => {
  const { renameReplacing } = await import('../../../../src/main/metadataRestoreJournal');
  const lockError = (code: string) => Object.assign(new Error(code), { code });
  const waits: number[] = [];
  let calls = 0;
  await renameReplacing('from', 'to', {
    platform: 'win32',
    wait: async (ms) => { waits.push(ms); },
    rename: async () => { calls++; if (calls < 3) throw lockError(calls === 1 ? 'EPERM' : 'EBUSY'); },
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [50, 100]);

  // Other platforms and non-lock errors fail on the first attempt.
  for (const [platform, code] of [['linux', 'EPERM'], ['win32', 'ENOENT']] as const) {
    let attempts = 0;
    await assert.rejects(renameReplacing('from', 'to', {
      platform, wait: async () => undefined,
      rename: async () => { attempts++; throw lockError(code); },
    }), { code });
    assert.equal(attempts, 1);
  }

  // A lock that never clears gives up after the bounded attempts.
  let attempts = 0;
  await assert.rejects(renameReplacing('from', 'to', {
    platform: 'win32', maxAttempts: 4, wait: async () => undefined,
    rename: async () => { attempts++; throw lockError('EACCES'); },
  }), { code: 'EACCES' });
  assert.equal(attempts, 4);
});
