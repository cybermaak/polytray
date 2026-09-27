import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { MetadataBackupSnapshot } from '../../../../src/shared/backupContracts';
import { createFilesTableForTests } from '../../../../src/main/fileIndexing';
import { createMetadataBackupService } from '../../../../src/main/metadataBackupService';

function createDatabase() {
  const db = new Database(':memory:');
  createFilesTableForTests(db);
  db.exec('ALTER TABLE files ADD COLUMN tags TEXT; ALTER TABLE files ADD COLUMN notes TEXT; ALTER TABLE files ADD COLUMN print_status TEXT;');
  return db;
}

function makeSnapshot(): MetadataBackupSnapshot {
  return {
    rendererRevision: 7,
    libraryRoots: ['/library'],
    collections: [{ id: 'all', name: 'All models', paths: ['/library/model-509.stl'] }],
    preferences: { gridSize: 'large', watch: true },
  };
}

test('export includes indexed annotations beyond page 500, collection membership, pending rows, and no model data', async () => {
  const db = createDatabase();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'polytray-backup-'));
  const target = path.join(root, 'metadata.json');
  const insert = db.prepare(`INSERT INTO files(path,name,extension,directory,size_bytes,modified_at,indexed_at,tags,notes,print_status)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const addRows = db.transaction(() => {
    for (let index = 0; index < 510; index += 1) {
      const modelPath = `/library/model-${index}.stl`;
      insert.run(modelPath, `model-${index}`, 'stl', '/library', 99, 10, 11, '["exported"]', index === 509 ? 'last-page 🐈' : null, 'Not Printed');
    }
  });
  addRows();
  const service = createMetadataBackupService({
    db,
    showSaveDialog: async () => ({ canceled: false, filePath: target }),
    appVersion: '1.1.1',
    now: () => new Date('2026-09-26T12:00:00.000Z'),
    getCurrentRendererRevision: () => 7,
    getPendingAnnotations: () => [{ path: '/offline/model.stl', tags: ['pending'], notes: 'pending note' }],
  });
  try {
    const result = await service.exportMetadata(makeSnapshot());
    assert.deepEqual(result, { status: 'exported', location: target, annotationCount: 510, collectionCount: 1, pendingAnnotationCount: 1 });
    const backup = JSON.parse(await fs.readFile(target, 'utf8'));
    assert.equal(backup.annotations.length, 510);
    assert.deepEqual(backup.annotations.find((entry: { path: string }) => entry.path === '/library/model-509.stl'), {
      path: '/library/model-509.stl', tags: ['exported'], notes: 'last-page 🐈', printStatus: 'Not Printed',
    });
    assert.deepEqual(backup.collections[0].paths, ['/library/model-509.stl']);
    assert.equal(backup.pendingAnnotations[0].notes, 'pending note');
    assert.equal('id' in backup.annotations[0], false);
    assert.equal('size_bytes' in backup.annotations[0], false);
    assert.equal('modelBytes' in backup, false);
    assert.equal(backup.manifest.sourceModelsIncluded, false);
    assert.deepEqual((await fs.readdir(root)).sort(), ['metadata.json']);
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('cancelled native dialog does not write a file', async () => {
  const db = createDatabase();
  let writes = 0;
  const service = createMetadataBackupService({
    db,
    showSaveDialog: async () => ({ canceled: true }),
    appVersion: '1.1.1',
    getCurrentRendererRevision: () => 7,
    writeAtomically: async () => { writes += 1; return 'written'; },
  });
  assert.deepEqual(await service.exportMetadata(makeSnapshot()), { status: 'cancelled' });
  assert.equal(writes, 0);
  db.close();
});

test('renderer revision changing while the save dialog is open prevents export', async () => {
  const db = createDatabase();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'polytray-backup-revision-'));
  const target = path.join(root, 'existing.json');
  await fs.writeFile(target, 'keep existing');
  let revision = 7;
  let openDialog!: () => void;
  let choosePath!: (value: { canceled: false; filePath: string }) => void;
  const dialogOpened = new Promise<void>((resolve) => { openDialog = resolve; });
  const dialogResult = new Promise<{ canceled: false; filePath: string }>((resolve) => { choosePath = resolve; });
  const service = createMetadataBackupService({
    db,
    showSaveDialog: () => { openDialog(); return dialogResult; },
    appVersion: '1.1.1',
    getCurrentRendererRevision: () => revision,
  });
  try {
    const pending = service.exportMetadata(makeSnapshot());
    await dialogOpened;
    revision = 8;
    choosePath({ canceled: false, filePath: target });
    assert.deepEqual(await pending, { status: 'failed', code: 'invalid-snapshot', message: 'Renderer state changed during export preparation' });
    assert.equal(await fs.readFile(target, 'utf8'), 'keep existing');
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('renderer revision changing before atomic rename preserves the existing backup', async () => {
  const db = createDatabase();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'polytray-backup-final-revision-'));
  const target = path.join(root, 'existing.json');
  await fs.writeFile(target, 'keep existing');
  let checks = 0;
  const service = createMetadataBackupService({
    db,
    showSaveDialog: async () => ({ canceled: false, filePath: target }),
    appVersion: '1.1.1',
    getCurrentRendererRevision: () => (++checks < 3 ? 7 : 8),
  });
  try {
    assert.deepEqual(await service.exportMetadata(makeSnapshot()), {
      status: 'failed', code: 'invalid-snapshot', message: 'Renderer state changed during export preparation',
    });
    assert.equal(await fs.readFile(target, 'utf8'), 'keep existing');
    assert.deepEqual((await fs.readdir(root)).sort(), ['existing.json']);
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('write failure preserves the pre-existing target', async () => {
  const db = createDatabase();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'polytray-backup-failure-'));
  const target = path.join(root, 'existing.json');
  await fs.writeFile(target, 'keep existing');
  const service = createMetadataBackupService({
    db,
    showSaveDialog: async () => ({ canceled: false, filePath: target }),
    appVersion: '1.1.1',
    getCurrentRendererRevision: () => 7,
    writeAtomically: async () => { throw new Error('disk full'); },
  });
  try {
    const result = await service.exportMetadata(makeSnapshot());
    assert.equal(result.status, 'failed');
    assert.equal(result.code, 'write-failed');
    assert.equal(await fs.readFile(target, 'utf8'), 'keep existing');
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
