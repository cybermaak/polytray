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
