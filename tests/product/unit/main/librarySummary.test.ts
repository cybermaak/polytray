import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../../../src/main/database';
import { createFileIndexRepository, type CommittedFileMutation } from '../../../../src/main/fileIndexing';
import { getLibraryRevisions } from '../../../../src/main/libraryRevisions';
import { createLibrarySummaryService, getLibrarySummaryService } from '../../../../src/main/librarySummary';
import { getArchiveEntryDirectory } from '../../../../src/shared/archivePaths';
import { getLibraryPage, getLibraryFiles } from '../../../../src/main/libraryQueries';

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(MIGRATIONS.map((migration) => migration.sql).join('\n'));
  db.prepare('UPDATE scope_backfill SET complete = 1 WHERE singleton = 1').run();
  return db;
}

function seedRecords(db: Database.Database) {
  const repository = createFileIndexRepository(db);
  const archivePath = path.resolve('/library/kits.zip');
  const records = [
    { path: path.resolve('/library/a.stl'), name: 'a', extension: 'stl', directory: path.resolve('/library'), sizeBytes: 100, modifiedAt: 10 },
    { path: path.resolve('/library/sub/b.obj'), name: 'b', extension: 'obj', directory: path.resolve('/library/sub'), sizeBytes: 200, modifiedAt: 20 },
    { path: `${archivePath}::entry::parts/c.3mf`, name: 'c', extension: '3mf', directory: getArchiveEntryDirectory(`${archivePath}::entry::parts/c.3mf`), sizeBytes: 300, modifiedAt: 30, archivePath },
  ];
  const result = repository.applyIndexBatch({
    scanGeneration: 1,
    records: records.map((record) => ({ ...record, scanGeneration: 1 })),
  });
  return { repository, records, committed: result.committed };
}

function captureQueries(db: Database.Database) {
  const statements: string[] = [];
  const originalPrepare = db.prepare;
  db.prepare = ((sql: string) => {
    const statement = originalPrepare.call(db, sql);
    return new Proxy(statement, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;
        if ((property === 'get' || property === 'all') && typeof value === 'function') {
          return (...args: unknown[]) => {
            statements.push(sql.replace(/\s+/g, ' ').trim());
            return value.apply(target, args);
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }) as typeof db.prepare;
  return {
    statements,
    stop() { db.prepare = originalPrepare; },
  };
}

test('summary reads use one aggregate and topology query, then stay warm across browse and thumbnail-only work', () => {
  const db = createDatabase();
  try {
    const { repository, committed } = seedRecords(db);
    const summary = getLibrarySummaryService(db);
    assert.strictEqual(summary, getLibrarySummaryService(db));
    const profile = captureQueries(db);
    const stats = summary.getStats();
    const directories = summary.getDirectories();

    assert.deepEqual(stats, { total: 3, stl: 1, obj: 1, threemf: 1, totalSize: 600 });
    assert.deepEqual(directories, [path.resolve('/library'), getArchiveEntryDirectory(`${path.resolve('/library/kits.zip')}::entry::parts/c.3mf`), path.resolve('/library/sub')].sort());
    const aggregateSql = () => profile.statements.filter((sql) => /SELECT COUNT\(\*\) AS total,/i.test(sql) && /FROM files/i.test(sql));
    const directorySql = () => profile.statements.filter((sql) => /SELECT DISTINCT directory FROM files/i.test(sql));
    assert.equal(aggregateSql().length, 1);
    assert.equal(directorySql().length, 1);
    assert.match(aggregateSql()[0], /SUM\(/i);

    const firstDirectories = summary.getDirectories();
    assert.strictEqual(firstDirectories, directories);
    getLibraryFiles(db, { sort: 'size', order: 'DESC', limit: 1 });
    getLibraryPage(db, {
      sort: 'name', direction: 'ASC', extension: 'stl', folder: null, search: 'a',
      collectionPaths: null, limit: 10, offset: 0,
    });
    repository.updateThumbnailState({
      fileId: committed[0].id,
      expectedContentRevision: committed[0].contentRevision,
      thumbnailPath: '/cache/a.png', thumbnailFailed: 0,
    });

    assert.deepEqual(summary.getStats(), stats);
    assert.strictEqual(summary.getDirectories(), directories);
    assert.equal(aggregateSql().length, 1);
    assert.equal(directorySql().length, 1);
  } finally {
    db.close();
  }
});

test('empty-library aggregates preserve the all-zero GET_STATS response', () => {
  const db = createDatabase();
  try {
    assert.deepEqual(createLibrarySummaryService(db).getStats(), {
      total: 0, stl: 0, obj: 0, threemf: 0, totalSize: 0,
    });
  } finally {
    db.close();
  }
});

test('directory cache preserves its array reference when a revision leaves the directory set unchanged', () => {
  const db = createDatabase();
  try {
    const { repository } = seedRecords(db);
    const summary = createLibrarySummaryService(db);
    const before = summary.getDirectories();
    const topologyRevision = getLibraryRevisions(db).topologyRevision;
    const newPath = path.resolve('/library/another.stl');
    repository.applyIndexBatch({ scanGeneration: 2, records: [{
      path: newPath, name: 'another', extension: 'stl', directory: path.dirname(newPath),
      sizeBytes: 25, modifiedAt: 40, scanGeneration: 2,
    }] });
    assert.ok(getLibraryRevisions(db).topologyRevision > topologyRevision);
    assert.strictEqual(summary.getDirectories(), before);
  } finally {
    db.close();
  }
});

test('annotation and geometry enrichment advance browse without invalidating stats or directory topology', () => {
  const db = createDatabase();
  try {
    const { repository, committed, records } = seedRecords(db);
    const mutations: CommittedFileMutation[] = [];
    createFileIndexRepository(db, (mutation) => mutations.push(mutation));
    const summary = createLibrarySummaryService(db);
    const beforeStats = summary.getStats();
    const beforeDirectories = summary.getDirectories();
    const profile = captureQueries(db);
    const initialRevisions = getLibraryRevisions(db);

    const annotation = repository.updateFileMetadata({
      fileId: committed[0].id,
      expectedContentRevision: committed[0].contentRevision,
      tags: ['favorite'],
      notes: 'Keep this annotation',
    });
    assert.equal(annotation.status, 'updated');
    assert.equal(repository.applyMetadataResult({
      fileId: committed[0].id,
      path: records[0].path,
      expectedContentRevision: committed[0].contentRevision,
      vertexCount: 42, faceCount: 13, dimensions: JSON.stringify({ x: 1, y: 2, z: 3 }),
    }).status, 'updated');

    const afterRevisions = getLibraryRevisions(db);
    assert.ok(afterRevisions.browseRevision > initialRevisions.browseRevision);
    assert.equal(afterRevisions.statsRevision, initialRevisions.statsRevision);
    assert.equal(afterRevisions.topologyRevision, initialRevisions.topologyRevision);
    assert.equal(mutations.length, 2);
    assert.equal(mutations[0].annotationsChanged, true);
    assert.equal(mutations[0].statsChanged, false);
    assert.equal(mutations[0].topologyChanged, false);
    assert.equal(mutations[1].rowsChanged, true);
    assert.equal(mutations[1].statsChanged, false);
    assert.equal(mutations[1].topologyChanged, false);
    assert.deepEqual(summary.getStats(), beforeStats);
    assert.strictEqual(summary.getDirectories(), beforeDirectories);
    assert.equal(profile.statements.filter((sql) => /FROM files/i.test(sql) && /COUNT\(/i.test(sql)).length, 0);
    assert.equal(profile.statements.filter((sql) => /SELECT DISTINCT directory FROM files/i.test(sql)).length, 0);
  } finally {
    db.close();
  }
});

test('mtime-only and thumbnail changes avoid stats reads while size and extension changes invalidate them', () => {
  const db = createDatabase();
  try {
    const { repository, committed, records } = seedRecords(db);
    const mutations: CommittedFileMutation[] = [];
    createFileIndexRepository(db, (mutation) => mutations.push(mutation));
    const summary = createLibrarySummaryService(db);
    summary.getStats();
    summary.getDirectories();
    const profile = captureQueries(db);
    let identity = repository.getFileIdentityByPath(records[0].path)!;
    const statsRevision = () => getLibraryRevisions(db).statsRevision;
    let revision = statsRevision();

    repository.applyIndexBatch({ scanGeneration: 2, records: [{
      path: records[0].path, name: records[0].name, extension: records[0].extension,
      directory: records[0].directory, sizeBytes: records[0].sizeBytes,
      modifiedAt: records[0].modifiedAt + 1, scanGeneration: 2,
    }] });
    assert.equal(mutations.at(-1)?.statsChanged, false);
    assert.equal(statsRevision(), revision);
    summary.getStats();
    assert.equal(profile.statements.filter((sql) => /FROM files/i.test(sql) && /COUNT\(/i.test(sql)).length, 0);

    identity = repository.getFileIdentityByPath(records[0].path)!;
    repository.updateThumbnailState({ fileId: identity.id, expectedContentRevision: identity.contentRevision,
      thumbnailPath: '/cache/a.png', thumbnailFailed: 0 });
    assert.equal(mutations.at(-1)?.thumbnailOnly, true);
    assert.equal(mutations.at(-1)?.statsChanged, false);
    summary.getStats();
    assert.equal(statsRevision(), revision);
    assert.equal(profile.statements.filter((sql) => /FROM files/i.test(sql) && /COUNT\(/i.test(sql)).length, 0);

    repository.applyIndexBatch({ scanGeneration: 3, records: [{
      path: records[0].path, name: records[0].name, extension: records[0].extension,
      directory: records[0].directory, sizeBytes: records[0].sizeBytes + 25,
      modifiedAt: records[0].modifiedAt + 1, scanGeneration: 3,
    }] });
    assert.equal(mutations.at(-1)?.statsChanged, true);
    assert.equal(statsRevision(), ++revision);
    assert.equal(summary.getStats().totalSize, 625);
    assert.equal(profile.statements.filter((sql) => /FROM files/i.test(sql) && /COUNT\(/i.test(sql)).length, 1);

    repository.applyIndexBatch({ scanGeneration: 4, records: [{
      path: records[0].path, name: records[0].name, extension: '3mf',
      directory: records[0].directory, sizeBytes: records[0].sizeBytes + 25,
      modifiedAt: records[0].modifiedAt + 1, scanGeneration: 4,
    }] });
    assert.equal(mutations.at(-1)?.statsChanged, true);
    assert.equal(statsRevision(), ++revision);
    const reformatted = summary.getStats();
    assert.equal(reformatted.stl, 0);
    assert.equal(reformatted.threemf, 2);
    assert.equal(profile.statements.filter((sql) => /FROM files/i.test(sql) && /COUNT\(/i.test(sql)).length, 2);
    assert.ok(committed.length === 3);
  } finally {
    db.close();
  }
});

test('insertions, directory moves, and deletions refresh counts and ZIP/native directory lists only when read', () => {
  const db = createDatabase();
  try {
    const { repository, records } = seedRecords(db);
    const summary = createLibrarySummaryService(db);
    assert.deepEqual(summary.getDirectories(), [path.resolve('/library'), getArchiveEntryDirectory(`${path.resolve('/library/kits.zip')}::entry::parts/c.3mf`), path.resolve('/library/sub')].sort());
    const initial = summary.getStats();
    const originalDirectories = summary.getDirectories();
    let profile = captureQueries(db);

    const newPath = path.resolve('/library/new/d.stl');
    const inserted = repository.applyIndexBatch({ scanGeneration: 5, records: [{
      path: newPath, name: 'd', extension: 'stl', directory: path.dirname(newPath),
      sizeBytes: 400, modifiedAt: 40, scanGeneration: 5,
    }] });
    assert.equal(inserted.inserted, 1);
    const withNew = summary.getStats();
    assert.equal(withNew.total, initial.total + 1);
    assert.equal(withNew.totalSize, initial.totalSize + 400);
    const withNewDirectories = summary.getDirectories();
    assert.notStrictEqual(withNewDirectories, originalDirectories);
    assert.ok(withNewDirectories.includes(path.dirname(newPath)));
    assert.equal(profile.statements.filter((sql) => /FROM files/i.test(sql) && /COUNT\(/i.test(sql)).length, 1);
    assert.equal(profile.statements.filter((sql) => /SELECT DISTINCT directory FROM files/i.test(sql)).length, 1);
    profile.stop();

    const movedPath = records[1].path;
    const movedDirectory = path.resolve('/library/moved');
    const beforeMoveStatsRevision = getLibraryRevisions(db).statsRevision;
    repository.applyIndexBatch({ scanGeneration: 6, records: [{
      path: movedPath, name: 'b', extension: 'obj', directory: movedDirectory,
      sizeBytes: 200, modifiedAt: 20, scanGeneration: 6,
    }] });
    const afterMoveDirectories = summary.getDirectories();
    assert.notStrictEqual(afterMoveDirectories, withNewDirectories);
    assert.ok(afterMoveDirectories.includes(movedDirectory));
    assert.ok(!afterMoveDirectories.includes(path.resolve('/library/sub')));
    assert.equal(getLibraryRevisions(db).statsRevision, beforeMoveStatsRevision);
    assert.deepEqual(summary.getStats(), withNew);

    const identity = repository.getFileIdentityByPath(newPath)!;
    const deleted = repository.applyWatchUpdate({ kind: 'remove', path: newPath, expectedContentRevision: identity.contentRevision });
    assert.equal(deleted.statsChanged, true);
    assert.equal(deleted.topologyChanged, true);
    assert.equal(summary.getStats().total, initial.total);
    assert.deepEqual(summary.getDirectories(), afterMoveDirectories.filter((directory) => directory !== path.dirname(newPath)));
  } finally {
    db.close();
  }
});
