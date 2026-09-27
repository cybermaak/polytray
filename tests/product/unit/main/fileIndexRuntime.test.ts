import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createDbAtVersion } from '../../../support/helpers/databaseFixtures';
import { applyScannedFileRecord } from '../../../../src/main/fileIndexing';
import { createFileIndexRuntime } from '../../../../src/main/fileIndexRuntime';

function openMigratedDatabase() {
  const fixture = createDbAtVersion(5);
  return { ...fixture, db: new Database(fixture.dbPath) };
}

test('runtime subscribes before writes and keeps scope reads gated through bounded resumable backfill', async () => {
  const fixture = openMigratedDatabase();
  const { db } = fixture;
  try {
    const insert = db.prepare(`INSERT INTO files (
      path, name, extension, directory, size_bytes, modified_at, indexed_at
    ) VALUES (?, ?, 'stl', '/models', 1, 1, 1)`);
    for (let index = 0; index < 5; index++) insert.run(`/models/${index}.stl`, String(index));

    const mutations: string[][] = [];
    const pages: Array<{ status: string; processedTotal: number; complete: boolean }> = [];
    let yields = 0;
    const runtime = createFileIndexRuntime(db, {
      batchSize: 2,
      onMutation: (mutation) => mutations.push(mutation.affectedPaths),
      onProgress: (progress) => {
        pages.push(progress);
        assert.equal((db.prepare('SELECT COUNT(*) AS count FROM files').get() as { count: number }).count, 6);
      },
      yieldToEventLoop: async () => { yields++; await Promise.resolve(); },
    });

    applyScannedFileRecord(db, {
      path: '/models/new.stl', name: 'new', ext: 'stl', dir: '/models', size: 1, mtime: 1,
      vertexCount: 1, faceCount: 1, dimensions: null, indexedAt: 1,
    });
    assert.deepEqual(mutations, [['/models/new.stl']]);
    assert.equal(runtime.canUseScopeReader(), false);

    await runtime.startBackfill();
    assert.equal(runtime.canUseScopeReader(), true);
    assert.deepEqual(pages.filter((page) => page.status === 'backfilling').map((page) => page.processedTotal), [0, 2, 4, 6]);
    assert.ok(yields >= 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM file_scopes').get()?.count, 12);
  } finally {
    db.close();
    const fs = await import('node:fs');
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('runtime disposal cancels a pending page yield and removes its observer', async () => {
  const fixture = openMigratedDatabase();
  const { db } = fixture;
  let releaseYield!: () => void;
  const yieldGate = new Promise<void>((resolve) => { releaseYield = resolve; });
  try {
    db.prepare(`INSERT INTO files (path, name, extension, directory, size_bytes, modified_at, indexed_at)
      VALUES ('/models/a.stl', 'a', 'stl', '/models', 1, 1, 1)`).run();
    const progress: string[] = [];
    const mutations: string[][] = [];
    const runtime = createFileIndexRuntime(db, {
      batchSize: 1,
      onMutation: (mutation) => mutations.push(mutation.affectedPaths),
      onProgress: (value) => progress.push(value.status),
      yieldToEventLoop: () => yieldGate,
    });
    const running = runtime.startBackfill();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await runtime.dispose();
    await running;
    releaseYield();

    assert.equal(runtime.canUseScopeReader(), false);
    assert.equal(progress.includes('disposed'), true);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM file_scopes').get() as { count: number }).count, 2);
    applyScannedFileRecord(db, {
      path: '/models/after-dispose.stl', name: 'after', ext: 'stl', dir: '/models', size: 1, mtime: 1,
      vertexCount: 0, faceCount: 0, dimensions: null, indexedAt: 1,
    });
    assert.deepEqual(mutations, []);
  } finally {
    db.close();
    const fs = await import('node:fs');
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('runtime records and reports backfill failure without switching readers', async () => {
  const fixture = openMigratedDatabase();
  const { db } = fixture;
  try {
    db.exec('DROP TABLE scope_backfill');
    const progress: Array<{ status: string; error?: string }> = [];
    const runtime = createFileIndexRuntime(db, { onProgress: (value) => progress.push(value) });
    await assert.rejects(runtime.startBackfill());
    assert.equal(runtime.canUseScopeReader(), false);
    assert.equal(runtime.getProgress().status, 'failed');
    assert.equal(progress.at(-1)?.status, 'failed');
    assert.ok(progress.at(-1)?.error);
    await runtime.dispose();
  } finally {
    db.close();
    const fs = await import('node:fs');
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});
