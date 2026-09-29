import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createMetadataRestoreService } from '../../../../src/main/metadataRestoreService';
import { createMetadataRestoreJournal } from '../../../../src/main/metadataRestoreJournal';
import { createFileIndexRepository } from '../../../../src/main/fileIndexing';
import { createDbAtVersion } from '../../../support/helpers/databaseFixtures';
import { buildMetadataBackupV1 } from '../../../../src/shared/metadataBackup';

function createDb() {
  const fixture = createDbAtVersion(6);
  return { db: new Database(fixture.dbPath), fixture };
}

function backup() {
  return buildMetadataBackupV1({ exportedAt: '2026-09-28T00:00:00.000Z', appVersion: '1.0.0',
    indexedAnnotations: [{ path: '/foreign/model.stl', tags: ['restored'], notes: 'pending note' }], pendingAnnotations: [],
    snapshot: { rendererRevision: 7, libraryRoots: [], collections: [], preferences: {} } });
}

const rendererState = { rendererRevision: 7, libraryRoots: ['/models'], collections: [], preferences: { customPreference: 'keep-me' } };
const noMutationLease = { acquireMutationLease: async () => () => undefined };

test('successful acknowledgment releases the cached preview while preserving committed replay', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-plan-release-'));
  const service = createMetadataRestoreService({
    ...noMutationLease,
    db, journal: createMetadataRestoreJournal(dir), recoveryDirectory: path.join(dir, 'backups'),
    getRendererRevision: () => 7, getRendererState: () => rendererState, applyRendererState: async () => undefined,
  });
  try {
    const plan = service.previewImport(backup(), rendererState);
    assert.equal(service.getPreparedPlanCount(), 1);
    const staged = await service.commitImport(plan.transactionId);
    assert.equal(staged.status, 'staged');
    const cannotCancel = await service.cancelImport(plan.transactionId).then(() => '', error => String(error));
    assert.match(cannotCancel, /cannot be canceled|recover/i);
    assert.equal(service.getPreparedPlanCount(), 1);
    await service.acknowledgeImport(plan.transactionId, 7);
    assert.equal(service.getPreparedPlanCount(), 0);
    const replayed = await service.commitImport(plan.transactionId);
    assert.equal(replayed.status, 'staged');
    assert.equal((db.prepare('SELECT state FROM metadata_import_transactions WHERE transaction_id = ?').get(plan.transactionId) as { state: string }).state, 'complete');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('restore persists unmatched annotations and advances the durable browse revision once', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-'));
  const applied: unknown[] = [];
  const mutations: Array<{ annotationsChanged: boolean; addedPaths?: string[]; browseRevision: number }> = [];
  const repository = createFileIndexRepository(db, mutation => mutations.push(mutation));
  const service = createMetadataRestoreService({
    ...noMutationLease,
    db, journal: createMetadataRestoreJournal(dir), recoveryDirectory: path.join(dir, 'backups'),
    getRendererRevision: () => 7, getRendererState: () => rendererState,
    applyRendererState: async state => { applied.push(state); },
  });
  try {
    const plan = service.previewImport(backup(), rendererState);
    const beforeRevision = repository.getBrowseRevision();
    const staged = await service.commitImport(plan);
    assert.equal(staged.status, 'staged');
    assert.equal(staged.rendererState.settings.customPreference, 'keep-me');
    assert.equal(repository.getBrowseRevision(), beforeRevision + 1);
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].annotationsChanged, true);
    assert.deepEqual(mutations[0].addedPaths, []);
    const pending = db.prepare('SELECT canonical_path, path, tags, notes FROM pending_annotations').all();
    assert.deepEqual(pending, [{ canonical_path: '/foreign/model.stl', path: '/foreign/model.stl', tags: '["restored"]', notes: 'pending note' }]);
    assert.equal(applied.length, 0);
    applied.push(staged.rendererState);
    await service.acknowledgeImport(plan.transactionId, 7);
    await service.acknowledgeImport(plan.transactionId, 7);
    assert.equal(db.prepare('SELECT state FROM metadata_import_transactions WHERE transaction_id = ?').get(plan.transactionId)?.state, 'complete');
  } finally {
    db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('restore recovery follows the SQLite marker after renderer application is interrupted', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-recovery-'));
  const repository = createFileIndexRepository(db);
  let writes = 0;
  const applyRendererState = async () => { writes++; if (writes === 1) throw new Error('injected renderer interruption'); };
  const makeService = () => createMetadataRestoreService({
    ...noMutationLease,
    db, journal: createMetadataRestoreJournal(dir), recoveryDirectory: path.join(dir, 'backups'),
    getRendererRevision: () => 7, getRendererState: () => rendererState,
    applyRendererState,
  });
  try {
    const service = makeService();
    const plan = service.previewImport(backup(), rendererState);
    const committed = await service.commitImport(plan);
    assert.equal(committed.status, 'staged');
    await assert.rejects(applyRendererState(), /injected renderer interruption/);
    const restarted = makeService();
    const recovery = await restarted.reconcileImport();
    assert.equal(recovery.status, 'roll-forward');
    assert.equal(writes, 2);
    assert.equal(db.prepare('SELECT state FROM metadata_import_transactions WHERE transaction_id = ?').get(plan.transactionId)?.state, 'complete');
  } finally {
    db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('newly committed indexed paths consume matching pending annotations exactly once', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-match-'));
  const repository = createFileIndexRepository(db);
  const service = createMetadataRestoreService({
    ...noMutationLease,
    db, journal: createMetadataRestoreJournal(dir), recoveryDirectory: path.join(dir, 'backups'),
    getRendererRevision: () => 7, getRendererState: () => rendererState, applyRendererState: async () => undefined,
  });
  try {
    const document = buildMetadataBackupV1({ exportedAt: '2026-09-28T00:00:00.000Z', appVersion: '1.0.0',
      indexedAnnotations: [], pendingAnnotations: [{ path: '/foreign/new.stl', tags: ['later'], notes: 'from backup' }],
      snapshot: { rendererRevision: 7, libraryRoots: [], collections: [], preferences: {} } });
    const plan = service.previewImport(document, rendererState);
    const staged = await service.commitImport(plan);
    assert.equal(staged.status, 'staged');
    await service.acknowledgeImport(plan.transactionId, 7);
    repository.applyIndexBatch({ scanGeneration: 1, records: [{
      path: '/foreign/new.stl', name: 'new', extension: 'stl', directory: '/foreign', sizeBytes: 10, modifiedAt: 10, scanGeneration: 1,
    }] });
    const row = db.prepare('SELECT tags, notes FROM files WHERE path = ?').get('/foreign/new.stl') as { tags: string; notes: string | null };
    assert.deepEqual(row, { tags: '["later"]', notes: 'from backup' });
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM pending_annotations').get() as { count: number }).count, 0);
    const revision = repository.getBrowseRevision();
    repository.applyIndexBatch({ scanGeneration: 2, records: [{
      path: '/foreign/new.stl', name: 'new', extension: 'stl', directory: '/foreign', sizeBytes: 10, modifiedAt: 10, scanGeneration: 2,
    }] });
    assert.equal(repository.getBrowseRevision(), revision);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('restore rejects stale database revisions before the atomic commit and aborts its prepared journal', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-stale-'));
  let changed = false;
  const service = createMetadataRestoreService({
    ...noMutationLease,
    db, journal: createMetadataRestoreJournal(dir), recoveryDirectory: path.join(dir, 'backups'),
    getRendererRevision: () => 7, getRendererState: () => rendererState, applyRendererState: async () => undefined,
    afterPreparedJournal: () => {
      if (changed) return;
      changed = true;
      db.prepare('UPDATE library_revisions SET browse_revision = browse_revision + 1 WHERE singleton = 1').run();
    },
  });
  try {
    const plan = service.previewImport(backup(), rendererState);
    const result = await service.commitImport(plan);
    assert.equal(result.status, 'failed');
    assert.match(result.status === 'failed' ? result.message : '', /stale/i);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM metadata_import_transactions').get() as { count: number }).count, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM pending_annotations').get() as { count: number }).count, 0);
    assert.equal((await createMetadataRestoreJournal(dir).readPending()).length, 1);
    assert.deepEqual(await service.reconcileImport(), { status: 'none' });
    assert.equal((await createMetadataRestoreJournal(dir).readPending()).length, 0);
    assert.equal((await fs.promises.readdir(path.join(dir, 'backups'))).length, 0);
    assert.equal((await service.getStatus()).unresolved, false);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('incomplete SQLite marker rolls forward even if the redundant file journal is missing', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-marker-'));
  let applied = 0;
  const journal = createMetadataRestoreJournal(dir);
  const service = createMetadataRestoreService({
    ...noMutationLease,
    db, journal, recoveryDirectory: path.join(dir, 'backups'),
    getRendererRevision: () => 7, getRendererState: () => rendererState,
    applyRendererState: async () => { applied++; },
  });
  try {
    const plan = service.previewImport(backup(), rendererState);
    const staged = await service.commitImport(plan);
    assert.equal(staged.status, 'staged');
    await journal.remove(plan.transactionId);
    const recovery = await service.reconcileImport();
    assert.equal(recovery.status, 'roll-forward');
    assert.equal(applied, 1);
    assert.equal((db.prepare('SELECT state FROM metadata_import_transactions WHERE transaction_id = ?').get(plan.transactionId) as { state: string }).state, 'complete');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('restore resolves canonical indexed paths to the stored row and preserves conflicting existing values', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-indexed-'));
  const repository = createFileIndexRepository(db);
  repository.applyIndexBatch({ scanGeneration: 1, records: [{
    path: '/models/item.stl', name: 'item', extension: 'stl', directory: '/models', sizeBytes: 10, modifiedAt: 10, scanGeneration: 1,
  }] });
  db.prepare('UPDATE files SET tags = ?, notes = ?, print_status = ? WHERE path = ?').run('["current"]', 'keep my note', 'Testing', '/models/item.stl');
  const service = createMetadataRestoreService({
    ...noMutationLease,
    db, journal: createMetadataRestoreJournal(dir), recoveryDirectory: path.join(dir, 'backups'),
    getRendererRevision: () => 7, getRendererState: () => rendererState, applyRendererState: async () => undefined,
  });
  try {
    const document = buildMetadataBackupV1({ exportedAt: '2026-09-28T00:00:00.000Z', appVersion: '1.0.0',
      indexedAnnotations: [{ path: '/models/./item.stl', tags: ['restored'], notes: 'incoming note', printStatus: 'Printed' }], pendingAnnotations: [],
      snapshot: { rendererRevision: 7, libraryRoots: [], collections: [], preferences: {} } });
    const plan = service.previewImport(document, rendererState);
    const staged = await service.commitImport(plan);
    assert.equal(staged.status, 'staged');
    const row = db.prepare('SELECT id, path, tags, notes, print_status FROM files').get() as { id: number; path: string; tags: string; notes: string; print_status: string };
    assert.deepEqual(row, { id: 1, path: '/models/item.stl', tags: '["current","restored"]', notes: 'keep my note', print_status: 'Testing' });
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM pending_annotations').get() as { count: number }).count, 0);
    assert.equal(staged.rendererState.annotationConflicts.length, 2);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('SQLite commit survives a journal update failure and startup rolls the renderer forward', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-db-marker-'));
  const journal = createMetadataRestoreJournal(dir);
  let failed = false;
  const faultingJournal = {
    write: async (record: Parameters<typeof journal.write>[0]) => {
      if (record.state === 'database-applied' && !failed) { failed = true; throw new Error('forced journal transition failure'); }
      await journal.write(record);
    }, readPending: () => journal.readPending(), remove: (id: string) => journal.remove(id),
  };
  let applied = 0;
  const makeService = (useFaultingJournal: boolean) => createMetadataRestoreService({
    ...noMutationLease,
    db, journal: useFaultingJournal ? faultingJournal : journal, recoveryDirectory: path.join(dir, 'backups'),
    getRendererRevision: () => 7, getRendererState: () => rendererState, applyRendererState: async () => { applied++; },
  });
  try {
    const service = makeService(true);
    const plan = service.previewImport(backup(), rendererState);
    const result = await service.commitImport(plan);
    assert.equal(result.status, 'failed');
    assert.equal((db.prepare('SELECT state FROM metadata_import_transactions WHERE transaction_id = ?').get(plan.transactionId) as { state: string }).state, 'database-applied');
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM pending_annotations').get() as { count: number }).count, 1);
    const recovery = await makeService(false).reconcileImport();
    assert.equal(recovery.status, 'roll-forward');
    assert.equal(applied, 1);
    assert.equal((db.prepare('SELECT state FROM metadata_import_transactions WHERE transaction_id = ?').get(plan.transactionId) as { state: string }).state, 'complete');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('successful local state application without acknowledgment is repeated idempotently during recovery', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-ack-'));
  const appliedStates: unknown[] = [];
  const makeService = () => createMetadataRestoreService({
    ...noMutationLease,
    db, journal: createMetadataRestoreJournal(dir), recoveryDirectory: path.join(dir, 'backups'),
    getRendererRevision: () => 7, getRendererState: () => rendererState, applyRendererState: async state => { appliedStates.push(state); },
  });
  try {
    const service = makeService();
    const plan = service.previewImport(backup(), rendererState);
    const staged = await service.commitImport(plan);
    assert.equal(staged.status, 'staged');
    if (staged.status !== 'staged') throw new Error('expected staged state');
    await makeService().reconcileImport();
    assert.equal(appliedStates.length, 1);
    assert.equal((db.prepare('SELECT state FROM metadata_import_transactions WHERE transaction_id = ?').get(plan.transactionId) as { state: string }).state, 'complete');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('restore commits a backup with more than 500 pending annotations in one browse revision', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-large-'));
  const repository = createFileIndexRepository(db);
  const annotations = Array.from({ length: 501 }, (_, index) => ({
    path: `/foreign/models/${index}.stl`, tags: [`tag-${index}`], notes: null,
  }));
  const document = buildMetadataBackupV1({ exportedAt: '2026-09-28T00:00:00.000Z', appVersion: '1.0.0',
    indexedAnnotations: annotations, pendingAnnotations: [], snapshot: { rendererRevision: 7, libraryRoots: [], collections: [], preferences: {} } });
  const service = createMetadataRestoreService({
    ...noMutationLease,
    db, journal: createMetadataRestoreJournal(dir), recoveryDirectory: path.join(dir, 'backups'),
    getRendererRevision: () => 7, getRendererState: () => rendererState, applyRendererState: async () => undefined,
  });
  try {
    const before = repository.getBrowseRevision();
    const plan = service.previewImport(document, rendererState);
    const staged = await service.commitImport(plan);
    assert.equal(staged.status, 'staged');
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM pending_annotations').get() as { count: number }).count, 501);
    assert.equal(repository.getBrowseRevision(), before + 1);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('mutation lease spans staged renderer application through acknowledgment and then replays queued work', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-lease-'));
  let held = false;
  let released = 0;
  const service = createMetadataRestoreService({
    db, journal: createMetadataRestoreJournal(dir), recoveryDirectory: path.join(dir, 'backups'),
    acquireMutationLease: async () => { held = true; return () => { held = false; released++; }; },
    getRendererRevision: () => 7, getRendererState: () => rendererState, applyRendererState: async () => undefined,
  });
  try {
    const plan = service.previewImport(backup(), rendererState);
    const result = await service.commitImport(plan);
    assert.equal(result.status, 'staged');
    assert.equal(held, true);
    assert.equal(released, 0);
    await service.acknowledgeImport(plan.transactionId, 7);
    assert.equal(held, false);
    assert.equal(released, 1);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('pending annotations retain exact ZIP member identity and unrelated pending records', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-zip-'));
  const repository = createFileIndexRepository(db);
  db.prepare(`INSERT INTO pending_annotations (canonical_path, path, tags, notes, print_status, provenance, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('/foreign/other.stl', '/foreign/other.stl', '[]', 'unrelated', null, '[]', 1);
  repository.applyIndexBatch({ scanGeneration: 1, records: [{
    path: '/foreign/parts.zip::entry::parts/model.stl', name: 'model', extension: 'stl', directory: '/foreign', sizeBytes: 10, modifiedAt: 10, scanGeneration: 1,
  }] });
  const document = buildMetadataBackupV1({ exportedAt: '2026-09-28T00:00:00.000Z', appVersion: '1.0.0',
    indexedAnnotations: [{ path: '/foreign/parts.zip::entry::a/../parts/model.stl', tags: ['opaque'], notes: null }], pendingAnnotations: [],
    snapshot: { rendererRevision: 7, libraryRoots: [], collections: [], preferences: {} } });
  const service = createMetadataRestoreService({
    ...noMutationLease, db, journal: createMetadataRestoreJournal(dir), recoveryDirectory: path.join(dir, 'backups'),
    getRendererRevision: () => 7, getRendererState: () => rendererState, applyRendererState: async () => undefined,
  });
  try {
    const plan = service.previewImport(document, rendererState);
    assert.equal(plan.annotationUpdates.length, 0);
    assert.deepEqual(plan.pendingAnnotationUpdates.map(update => update.path), ['/foreign/parts.zip::entry::a/../parts/model.stl']);
    const result = await service.commitImport(plan);
    assert.equal(result.status, 'staged');
    assert.deepEqual(repository.getPendingAnnotations().map(row => row.path).sort(), [
      '/foreign/other.stl', '/foreign/parts.zip::entry::a/../parts/model.stl',
    ]);
    assert.deepEqual((db.prepare('SELECT tags FROM files WHERE path = ?').get('/foreign/parts.zip::entry::parts/model.stl') as { tags: string | null }).tags, null);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('pending match retry applies nonconflicting fields once and leaves conflicting values visible', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-conflict-'));
  const repository = createFileIndexRepository(db);
  repository.applyIndexBatch({ scanGeneration: 1, records: [{
    path: '/foreign/existing.stl', name: 'existing', extension: 'stl', directory: '/foreign', sizeBytes: 10, modifiedAt: 10, scanGeneration: 1,
  }] });
  db.prepare('UPDATE files SET tags = ?, notes = ?, print_status = ? WHERE path = ?').run('["current"]', 'keep this', 'Testing', '/foreign/existing.stl');
  db.prepare(`INSERT INTO pending_annotations (canonical_path, path, tags, notes, print_status, provenance, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('/foreign/existing.stl', '/foreign/existing.stl', '["incoming"]', 'different note', 'Printed', '["pendingAnnotations"]', 1);
  const service = createMetadataRestoreService({
    ...noMutationLease, db, journal: createMetadataRestoreJournal(dir), recoveryDirectory: path.join(dir, 'backups'),
    getRendererRevision: () => 7, getRendererState: () => rendererState, applyRendererState: async () => undefined,
  });
  try {
    assert.deepEqual(service.retryPendingAnnotations(), { appliedCount: 1, conflictCount: 1 });
    const row = db.prepare('SELECT tags, notes, print_status FROM files WHERE path = ?').get('/foreign/existing.stl');
    assert.deepEqual(row, { tags: '["current","incoming"]', notes: 'keep this', print_status: 'Testing' });
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM pending_annotations').get() as { count: number }).count, 1);
    const status = await service.getStatus();
    assert.equal(status.conflicts.length, 1);
    assert.equal(status.conflicts[0].path, '/foreign/existing.stl');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('acknowledgment waits until the current renderer snapshot equals the staged state', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-state-check-'));
  let actualState = rendererState;
  const service = createMetadataRestoreService({
    ...noMutationLease, db, journal: createMetadataRestoreJournal(dir), recoveryDirectory: path.join(dir, 'backups'),
    getRendererRevision: () => 7, getRendererState: () => actualState,
    applyRendererState: async staged => {
      actualState = { libraryRoots: staged.libraryRoots, collections: staged.collections, preferences: staged.settings };
    },
  });
  try {
    const document = buildMetadataBackupV1({ exportedAt: '2026-09-28T00:00:00.000Z', appVersion: '1.0.0',
      indexedAnnotations: [], pendingAnnotations: [], snapshot: { rendererRevision: 7, libraryRoots: [], collections: [], preferences: { lightMode: true } } });
    const plan = service.previewImport(document, rendererState, { replaceSettings: true });
    const result = await service.commitImport(plan);
    assert.equal(result.status, 'staged');
    await assert.rejects(service.acknowledgeImport(plan.transactionId, 7), /does not match/i);
    assert.equal((db.prepare('SELECT state FROM metadata_import_transactions WHERE transaction_id = ?').get(plan.transactionId) as { state: string }).state, 'database-applied');
    const recovery = await service.reconcileImport();
    assert.equal(recovery.status, 'roll-forward');
    assert.equal(actualState.preferences.lightMode, true);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('restore rechecks indexed file ID and content revision inside its SQLite transaction', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-identity-'));
  const repository = createFileIndexRepository(db);
  repository.applyIndexBatch({ scanGeneration: 1, records: [{
    path: '/models/identity.stl', name: 'identity', extension: 'stl', directory: '/models', sizeBytes: 10, modifiedAt: 10, scanGeneration: 1,
  }] });
  const service = createMetadataRestoreService({
    ...noMutationLease, db, journal: createMetadataRestoreJournal(dir), recoveryDirectory: path.join(dir, 'backups'),
    getRendererRevision: () => 7, getRendererState: () => rendererState, applyRendererState: async () => undefined,
    afterPreparedJournal: () => { db.prepare('UPDATE files SET content_revision = content_revision + 1 WHERE path = ?').run('/models/identity.stl'); },
  });
  try {
    const document = buildMetadataBackupV1({ exportedAt: '2026-09-28T00:00:00.000Z', appVersion: '1.0.0',
      indexedAnnotations: [{ path: '/models/identity.stl', tags: ['imported'], notes: null }], pendingAnnotations: [],
      snapshot: { rendererRevision: 7, libraryRoots: [], collections: [], preferences: {} } });
    const plan = service.previewImport(document, rendererState);
    const result = await service.commitImport(plan);
    assert.equal(result.status, 'failed');
    assert.match(result.status === 'failed' ? result.message : '', /content revision changed/i);
    assert.equal((db.prepare('SELECT tags FROM files WHERE path = ?').get('/models/identity.stl') as { tags: string | null }).tags, null);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM metadata_import_transactions').get() as { count: number }).count, 0);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('restore rejects a stale renderer revision and cancel-before-commit leaves no recovery artifacts', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-renderer-revision-'));
  let rendererRevision = 7;
  const journal = createMetadataRestoreJournal(dir);
  const service = createMetadataRestoreService({
    ...noMutationLease, db, journal, recoveryDirectory: path.join(dir, 'backups'),
    getRendererRevision: () => rendererRevision, getRendererState: () => rendererState, applyRendererState: async () => undefined,
  });
  try {
    const stalePlan = service.previewImport(backup(), rendererState);
    rendererRevision = 8;
    const result = await service.commitImport(stalePlan);
    assert.equal(result.status, 'failed');
    assert.match(result.status === 'failed' ? result.message : '', /stale/i);
    assert.equal((await journal.readPending()).length, 0);

    rendererRevision = 7;
    const cancelledPlan = service.previewImport(backup(), rendererState);
    assert.equal(service.getPreparedPlanCount(), 1);
    await service.cancelImport(cancelledPlan.transactionId);
    assert.equal(service.getPreparedPlanCount(), 0);
    const afterCancel = await service.commitImport(cancelledPlan.transactionId);
    assert.equal(afterCancel.status, 'failed');
    assert.match(afterCancel.status === 'failed' ? afterCancel.message : '', /not prepared/i);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM metadata_import_transactions').get() as { count: number }).count, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM pending_annotations').get() as { count: number }).count, 0);
    assert.equal((await fs.promises.readdir(dir)).some(name => name.endsWith('.json')), false);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('corrupt pre-import recovery backup remains visible and blocks marker-backed roll-forward', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-corrupt-backup-'));
  let held = false;
  const service = createMetadataRestoreService({
    db, journal: createMetadataRestoreJournal(dir), recoveryDirectory: path.join(dir, 'backups'),
    acquireMutationLease: async () => { held = true; return () => { held = false; }; },
    getRendererRevision: () => 7, getRendererState: () => rendererState, applyRendererState: async () => undefined,
  });
  try {
    const plan = service.previewImport(backup(), rendererState);
    const staged = await service.commitImport(plan);
    assert.equal(staged.status, 'staged');
    const marker = db.prepare('SELECT recovery_backup_path FROM metadata_import_transactions WHERE transaction_id = ?').get(plan.transactionId) as { recovery_backup_path: string };
    await fs.promises.writeFile(marker.recovery_backup_path, '{broken');
    const recovery = await service.reconcileImport();
    assert.equal(recovery.status, 'blocked');
    assert.equal(held, true);
    assert.equal(fs.existsSync(marker.recovery_backup_path), true);
    assert.equal((db.prepare('SELECT state FROM metadata_import_transactions WHERE transaction_id = ?').get(plan.transactionId) as { state: string }).state, 'database-applied');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('cancel serializes with a commit paused at prepared journal write and retains committed recovery evidence', async () => {
  const { db, fixture } = createDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-cancel-race-'));
  const journal = createMetadataRestoreJournal(dir);
  let preparedStarted!: () => void;
  let resumePrepared!: () => void;
  const preparedStartedPromise = new Promise<void>(resolve => { preparedStarted = resolve; });
  const preparedBlock = new Promise<void>(resolve => { resumePrepared = resolve; });
  const blockingJournal = {
    async write(record: Parameters<typeof journal.write>[0]) {
      if (record.state === 'prepared') { preparedStarted(); await preparedBlock; }
      await journal.write(record);
    },
    readPending: () => journal.readPending(),
    remove: (transactionId: string) => journal.remove(transactionId),
  };
  let leaseHeld = false;
  const service = createMetadataRestoreService({
    db, journal: blockingJournal, recoveryDirectory: path.join(dir, 'backups'),
    acquireMutationLease: async () => { leaseHeld = true; return () => { leaseHeld = false; }; },
    getRendererRevision: () => 7, getRendererState: () => rendererState, applyRendererState: async () => undefined,
  });
  try {
    const plan = service.previewImport(backup(), rendererState);
    const commitPromise = service.commitImport(plan);
    await preparedStartedPromise;
    const cancelPromise = service.cancelImport(plan.transactionId).then(() => 'cancelled', error => `rejected:${String(error)}`);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(leaseHeld, true);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM metadata_import_transactions').get() as { count: number }).count, 0);
    resumePrepared();
    const commit = await commitPromise;
    assert.equal(commit.status, 'staged');
    const cancelResult = await cancelPromise;
    assert.match(cancelResult, /cannot be canceled|recover/i);
    assert.equal(leaseHeld, true);
    const marker = db.prepare('SELECT state, recovery_backup_path FROM metadata_import_transactions WHERE transaction_id = ?').get(plan.transactionId) as { state: string; recovery_backup_path: string };
    assert.equal(marker.state, 'database-applied');
    assert.equal(fs.existsSync(marker.recovery_backup_path), true);
    assert.equal((await journal.read(plan.transactionId)).state, 'database-applied');
    await service.acknowledgeImport(plan.transactionId, 7);
    assert.equal(leaseHeld, false);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});
