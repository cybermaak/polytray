import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../../../src/main/database';
import { createFileIndexRepository } from '../../../../src/main/fileIndexing';
import { backfillFileScopes } from '../../../../src/main/fileScopes';
import { ARCHIVE_ENTRY_SEPARATOR, getArchiveEntryDirectory } from '../../../../src/shared/archivePaths';
import type { LibraryItem, LibraryQuery, LibrarySortField } from '../../../../src/shared/libraryQuery';
import { createPerformanceDatabase } from '../../../support/fixtures/performanceFixtures';
import { explainLibraryFilesQuery, explainLibraryPageQuery, getLibraryFiles, getLibraryPage } from '../../../../src/main/libraryQueries';

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(MIGRATIONS.map((migration) => migration.sql).join('\n'));
  db.prepare('UPDATE scope_backfill SET complete = 1 WHERE singleton = 1').run();
  return db;
}

function defaultQuery(overrides: Partial<LibraryQuery> = {}): LibraryQuery {
  return {
    sort: 'name', direction: 'ASC', extension: null, folder: null, search: '',
    collectionPaths: null, limit: 500, offset: 0, ...overrides,
  };
}

function seed(db: Database.Database, records: Array<{
  path: string; name: string; extension: string; directory: string;
  sizeBytes?: number; modifiedAt?: number; vertexCount?: number; faceCount?: number; scanGeneration?: number;
}>) {
  const repository = createFileIndexRepository(db);
  const batch = repository.applyIndexBatch({
    scanGeneration: 1,
    records: records.map((record) => ({
      path: record.path,
      name: record.name,
      extension: record.extension,
      directory: record.directory,
      sizeBytes: record.sizeBytes ?? 10,
      modifiedAt: record.modifiedAt ?? 1,
      scanGeneration: record.scanGeneration ?? 1,
    })),
  });
  const recordsByPath = new Map(records.map((record) => [record.path, record]));
  for (const identity of batch.committed) {
    const record = recordsByPath.get(identity.path)!;
    if (record.vertexCount === undefined && record.faceCount === undefined) continue;
    repository.applyMetadataResult({
      fileId: identity.id,
      path: identity.path,
      expectedContentRevision: identity.contentRevision,
      vertexCount: record.vertexCount ?? 0,
      faceCount: record.faceCount ?? 0,
      dimensions: null,
    });
  }
  return batch;
}

function openPerformanceDatabase(count: number) {
  const fixture = createPerformanceDatabase({ count });
  const db = new Database(fixture.dbPath);
  while (true) {
    const page = backfillFileScopes(db, 1000);
    if (page.complete) break;
  }
  return { fixture, db };
}

function itemSortValue(item: LibraryItem, sort: LibrarySortField): string | number {
  if (item.kind === 'archive') {
    switch (sort) {
      case 'name': return item.name;
      case 'size': return item.sizeBytes;
      case 'date': return item.modifiedAt;
      case 'vertices': return item.vertexCount;
      case 'faces': return item.faceCount;
    }
  }
  switch (sort) {
    case 'name': return item.file.name;
    case 'size': return item.file.size_bytes;
    case 'date': return item.file.modified_at;
    case 'vertices': return item.file.vertex_count;
    case 'faces': return item.file.face_count;
  }
}

function compareItemKeys(left: LibraryItem, right: LibraryItem) {
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

test('600-file pages cover every stable file key with exact total counts and next offsets', () => {
  const { fixture, db } = openPerformanceDatabase(600);
  try {
    const first = getLibraryPage(db, defaultQuery({ limit: 500 }));
    assert.equal(first.status, 'ok');
    if (first.status !== 'ok') return;
    assert.equal(first.totalItems, 600);
    assert.equal(first.totalModels, 600);
    assert.equal(first.items.length, 500);
    assert.equal(first.nextOffset, 500);

    const second = getLibraryPage(db, defaultQuery({ limit: 500, offset: first.nextOffset }));
    assert.equal(second.status, 'ok');
    if (second.status !== 'ok') return;
    assert.equal(second.items.length, 100);
    assert.equal(second.nextOffset, null);
    const pastEnd = getLibraryPage(db, defaultQuery({ limit: 500, offset: 700 }));
    assert.equal(pastEnd.status, 'ok');
    if (pastEnd.status !== 'ok') return;
    assert.deepEqual(pastEnd.items, []);
    assert.equal(pastEnd.totalModels, 600);
    assert.equal(pastEnd.totalItems, 600);
    assert.equal(pastEnd.nextOffset, null);
    const keys = [...first.items, ...second.items].map((item) => item.key);
    assert.equal(new Set(keys).size, 600);
    assert.deepEqual(keys.sort(), fixture.collections.collections[0].filePaths
      .map((_path, index) => `file:${index + 1}`).sort());
  } finally {
    db.close();
    fixture.cleanup();
  }
});

test('600-path collection pages remain exact while null and empty collection filters differ', () => {
  const { fixture, db } = openPerformanceDatabase(600);
  try {
    const all = getLibraryPage(db, defaultQuery({ limit: 700, collectionPaths: null }));
    const empty = getLibraryPage(db, defaultQuery({ limit: 700, collectionPaths: [] }));
    const first = getLibraryPage(db, defaultQuery({ limit: 500, collectionPaths: fixture.collections.collections[0].filePaths }));
    assert.equal(all.status, 'ok');
    assert.equal(empty.status, 'ok');
    assert.equal(first.status, 'ok');
    if (all.status !== 'ok' || empty.status !== 'ok' || first.status !== 'ok') return;
    assert.equal(all.totalItems, 600);
    assert.equal(empty.totalItems, 0);
    assert.equal(empty.totalModels, 0);
    assert.deepEqual(empty.items, []);
    assert.equal(first.totalItems, 600);
    assert.equal(first.nextOffset, 500);
    const second = getLibraryPage(db, defaultQuery({
      limit: 500, offset: 500, collectionPaths: fixture.collections.collections[0].filePaths,
    }));
    assert.equal(second.status, 'ok');
    if (second.status !== 'ok') return;
    assert.equal(second.items.length, 100);
    assert.equal(second.nextOffset, null);
  } finally {
    db.close();
    fixture.cleanup();
  }
});

test('every sort and direction keeps stable item-key ties across page boundaries', () => {
  const { fixture, db } = openPerformanceDatabase(600);
  try {
    db.prepare("UPDATE files SET name = 'Case.stl' WHERE id = 1").run();
    db.prepare("UPDATE files SET name = 'case.stl' WHERE id = 2").run();
    db.prepare("UPDATE files SET size_bytes = 123 WHERE id IN (3, 4, 5)").run();
    db.prepare("UPDATE files SET modified_at = 123 WHERE id IN (6, 7, 8)").run();
    db.prepare("UPDATE files SET vertex_count = 456 WHERE id IN (9, 10, 11)").run();
    db.prepare("UPDATE files SET face_count = 789 WHERE id IN (12, 13, 14)").run();

    for (const sort of ['name', 'size', 'date', 'vertices', 'faces'] as const) {
      for (const direction of ['ASC', 'DESC'] as const) {
        const items: LibraryItem[] = [];
        let offset = 0;
        while (true) {
          const page = getLibraryPage(db, defaultQuery({ sort, direction, limit: 37, offset }));
          assert.equal(page.status, 'ok');
          if (page.status !== 'ok') break;
          assert.equal(page.totalItems, 600);
          items.push(...page.items);
          if (page.nextOffset === null) break;
          assert.equal(page.nextOffset, offset + page.items.length);
          offset = page.nextOffset;
        }
        assert.equal(items.length, 600);
        assert.equal(new Set(items.map((item) => item.key)).size, 600);
        for (let index = 1; index < items.length; index++) {
          const previous = itemSortValue(items[index - 1], sort);
          const current = itemSortValue(items[index], sort);
          let valueComparison: number;
          if (sort === 'name') {
            const left = String(previous).toLowerCase();
            const right = String(current).toLowerCase();
            valueComparison = left < right ? -1 : left > right ? 1 : 0;
          } else {
            valueComparison = Number(previous) < Number(current) ? -1 : Number(previous) > Number(current) ? 1 : 0;
          }
          if (direction === 'DESC') valueComparison *= -1;
          assert.ok(valueComparison < 0 || (valueComparison === 0 && compareItemKeys(items[index - 1], items[index]) < 0),
            `${sort} ${direction} order violated at ${items[index - 1].key}, ${items[index].key}`);
        }
      }
    }
    assert.ok(fixture.count === 600);
  } finally {
    db.close();
    fixture.cleanup();
  }
});

test('archive summaries are complete across model pages with bounded thumbnail samples', () => {
  const db = createDatabase();
  try {
    const root = path.resolve('/tmp/library-query-archives');
    const firstArchive = path.join(root, 'first.zip');
    const secondArchive = path.join(root, 'second.zip');
    const records = Array.from({ length: 501 }, (_, index) => {
      const virtualPath = `${firstArchive}${ARCHIVE_ENTRY_SEPARATOR}parts/alpha-${String(index).padStart(3, '0')}.stl`;
      return {
        path: virtualPath, name: `alpha-${String(index).padStart(3, '0')}`, extension: 'stl',
        directory: getArchiveEntryDirectory(virtualPath), sizeBytes: index + 1, modifiedAt: index + 1,
        vertexCount: index + 2, faceCount: index + 3,
      };
    });
    records.push(...[
      { path: `${secondArchive}${ARCHIVE_ENTRY_SEPARATOR}nested/other.obj`, name: 'other', extension: 'obj', directory: `${secondArchive}${ARCHIVE_ENTRY_SEPARATOR}nested`, sizeBytes: 17, modifiedAt: 4000, vertexCount: 7, faceCount: 5 },
      { path: `${secondArchive}${ARCHIVE_ENTRY_SEPARATOR}nested/another.stl`, name: 'another', extension: 'stl', directory: `${secondArchive}${ARCHIVE_ENTRY_SEPARATOR}nested`, sizeBytes: 13, modifiedAt: 3000, vertexCount: 11, faceCount: 9 },
      { path: path.join(root, 'loose.stl'), name: 'loose', extension: 'stl', directory: root, sizeBytes: 23, modifiedAt: 5000, vertexCount: 19, faceCount: 17 },
    ]);
    seed(db, records);

    const summaryPage = getLibraryPage(db, defaultQuery({ limit: 10 }));
    assert.equal(summaryPage.status, 'ok');
    if (summaryPage.status !== 'ok') return;
    assert.equal(summaryPage.totalModels, 504);
    assert.equal(summaryPage.totalItems, 3);
    const first = summaryPage.items.find((item) => item.kind === 'archive' && item.archivePath === firstArchive);
    const second = summaryPage.items.find((item) => item.kind === 'archive' && item.archivePath === secondArchive);
    assert.ok(first && first.kind === 'archive');
    assert.ok(second && second.kind === 'archive');
    assert.equal(first.modelCount, 501);
    assert.equal(first.vertexCount, records.slice(0, 501).reduce((sum, item) => sum + item.vertexCount!, 0));
    assert.equal(first.faceCount, records.slice(0, 501).reduce((sum, item) => sum + item.faceCount!, 0));
    assert.equal(first.sizeBytes, records.slice(0, 501).reduce((sum, item) => sum + item.sizeBytes!, 0));
    assert.equal(first.thumbnailSamples.length, 4);
    assert.equal(second.modelCount, 2);
    assert.ok(summaryPage.items.some((item) => item.kind === 'file' && item.file.name === 'loose'));

    const archiveFirstPage = getLibraryPage(db, defaultQuery({ archivePath: firstArchive, limit: 500 }));
    assert.equal(archiveFirstPage.status, 'ok');
    if (archiveFirstPage.status !== 'ok') return;
    assert.equal(archiveFirstPage.totalModels, 501);
    assert.equal(archiveFirstPage.totalItems, 501);
    assert.equal(archiveFirstPage.items.every((item) => item.kind === 'file'), true);
    assert.equal(archiveFirstPage.nextOffset, 500);
    const archiveSecondPage = getLibraryPage(db, defaultQuery({ archivePath: firstArchive, limit: 500, offset: 500 }));
    assert.equal(archiveSecondPage.status, 'ok');
    if (archiveSecondPage.status !== 'ok') return;
    assert.equal(archiveSecondPage.items.length, 1);
    assert.equal(archiveSecondPage.nextOffset, null);

    const nestedArchivePage = getLibraryPage(db, defaultQuery({
      folder: `${firstArchive}${ARCHIVE_ENTRY_SEPARATOR}parts`, limit: 500,
    }));
    assert.equal(nestedArchivePage.status, 'ok');
    if (nestedArchivePage.status !== 'ok') return;
    assert.equal(nestedArchivePage.totalItems, 501);
    assert.equal(nestedArchivePage.items.every((item) => item.kind === 'file'), true);

    const searchPage = getLibraryPage(db, defaultQuery({ search: 'alpha-500', limit: 20 }));
    assert.equal(searchPage.status, 'ok');
    if (searchPage.status !== 'ok') return;
    assert.equal(searchPage.totalItems, 1);
    assert.equal(searchPage.items[0].kind, 'file');
  } finally {
    db.close();
  }
});

test('archive member path aliases stay distinct file identities despite shared scope keys', () => {
  const db = createDatabase();
  try {
    const archivePath = path.resolve('/tmp/opaque-members.zip');
    const aliasPath = `${archivePath}${ARCHIVE_ENTRY_SEPARATOR}folder/../part.stl`;
    const canonicalLookingPath = `${archivePath}${ARCHIVE_ENTRY_SEPARATOR}part.stl`;
    seed(db, [
      { path: aliasPath, name: 'alias', extension: 'stl', directory: `${archivePath}${ARCHIVE_ENTRY_SEPARATOR}folder/..` },
      { path: canonicalLookingPath, name: 'part', extension: 'stl', directory: `${archivePath}${ARCHIVE_ENTRY_SEPARATOR}` },
    ]);

    const page = getLibraryPage(db, defaultQuery({ archivePath, limit: 10 }));
    assert.equal(page.status, 'ok');
    if (page.status !== 'ok') return;
    assert.equal(page.totalModels, 2);
    assert.equal(page.totalItems, 2);
    assert.equal(new Set(page.items.map((item) => item.key)).size, 2);
    const memberPaths = page.items.filter((item) => item.kind === 'file').map((item) => item.file.path);
    assert.deepEqual(new Set(memberPaths), new Set([aliasPath, canonicalLookingPath]));
  } finally {
    db.close();
  }
});

test('literal wildcard, quote, and backslash search values are bound and collection tables are isolated', () => {
  const db = createDatabase();
  try {
    const root = path.resolve('/tmp/library-query-literals');
    const targetPath = path.join(root, 'literal.stl');
    seed(db, [
      { path: targetPath, name: `percent%_quote'\\name`, extension: 'stl', directory: root },
      { path: path.join(root, 'ordinary.stl'), name: 'ordinary', extension: 'stl', directory: root },
    ]);
    db.prepare('UPDATE files SET tags = ? WHERE path = ?').run(JSON.stringify([`tag%_quote'\\value`]), targetPath);
    const targetQuery = (search: string) => getLibraryPage(db, defaultQuery({ folder: root, search, limit: 10 }));
    for (const search of ['%', '_', "'", '\\']) {
      const page = targetQuery(search);
      assert.equal(page.status, 'ok');
      if (page.status !== 'ok') continue;
      assert.equal(page.totalModels, 1);
      assert.equal(page.items[0].kind, 'file');
      assert.equal(page.items[0].file.path, targetPath);
    }

    const rowPaths = Array.from({ length: 10_000 }, (_, index) => `/unrelated/quote'\\%_${index}`);
    rowPaths.push(targetPath);
    const collectionPage = getLibraryPage(db, defaultQuery({ collectionPaths: rowPaths, limit: 10 }));
    assert.equal(collectionPage.status, 'ok');
    if (collectionPage.status !== 'ok') return;
    assert.equal(collectionPage.totalModels, 1);
    assert.equal(collectionPage.items.length, 1);
    assert.equal(collectionPage.items[0].kind, 'file');
    assert.equal(collectionPage.items[0].file.path, targetPath);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM files').get() as { count: number }).count, 2);
    const tempTables = db.prepare("SELECT name FROM sqlite_temp_master WHERE type = 'table'").all() as Array<{ name: string }>;
    assert.deepEqual(tempTables, []);
  } finally {
    db.close();
  }
});

test('collection membership temp table is removed when a page query fails', () => {
  const db = createDatabase();
  try {
    const root = path.resolve('/tmp/library-query-collection-failure');
    const filePath = path.join(root, 'part.stl');
    seed(db, [{ path: filePath, name: 'part', extension: 'stl', directory: root }]);
    const databaseWithPrepare = db as unknown as { prepare(sql: string): Record<string, (...args: unknown[]) => unknown> };
    const originalPrepare = databaseWithPrepare.prepare.bind(db);
    databaseWithPrepare.prepare = (sql: string) => {
      const statement = originalPrepare(sql);
      if (!sql.includes('SELECT display_items.*')) return statement;
      statement.all = () => {
        const tempTable = db.prepare("SELECT COUNT(*) AS count FROM sqlite_temp_master WHERE type = 'table' AND name = '__polytray_library_collection_paths'").get() as { count: number };
        assert.equal(tempTable.count, 1, 'collection membership should exist while the query is active');
        throw new Error('injected page query failure');
      };
      return statement;
    };

    assert.throws(() => getLibraryPage(db, defaultQuery({ collectionPaths: [filePath], limit: 10 })), /injected page query failure/);
    const tempTables = db.prepare("SELECT name FROM sqlite_temp_master WHERE type = 'table'").all() as Array<{ name: string }>;
    assert.deepEqual(tempTables, []);
  } finally {
    db.close();
  }
});

test('browse revision mismatch is stale and legacy folder reads use indexed containment and SQL order', () => {
  const { fixture, db } = openPerformanceDatabase(600);
  try {
    const initialRevision = getLibraryPage(db, defaultQuery({ limit: 1 }));
    assert.equal(initialRevision.status, 'ok');
    if (initialRevision.status !== 'ok') return;
    createFileIndexRepository(db).applyIndexBatch({ scanGeneration: 2, records: [{
      path: path.join(fixture.root, 'library', 'folder-new', 'new.stl'), name: 'new.stl', extension: 'stl',
      directory: path.join(fixture.root, 'library', 'folder-new'), sizeBytes: 10, modifiedAt: 10, scanGeneration: 2,
    }] });
    const stale = getLibraryPage(db, defaultQuery({ expectedBrowseRevision: initialRevision.revision }));
    assert.deepEqual(stale, { status: 'stale', revision: initialRevision.revision + 1 });

    const folder = path.join(fixture.root, 'library', 'folder-00');
    const legacy = getLibraryFiles(db, { folder, limit: 100, offset: 0, sort: 'name', order: 'ASC' });
    assert.equal(legacy.total, 15);
    assert.equal(legacy.files.length, 15);
    assert.equal(legacy.files.every((file) => file.path.startsWith(`${folder}${path.sep}`)), true);
    const siblingPrefix = getLibraryFiles(db, { folder: `${folder}-backup`, limit: 100, offset: 0 });
    assert.equal(siblingPrefix.total, 0);

    const folderPlan = explainLibraryPageQuery(db, defaultQuery({ folder, limit: 20 }));
    assert.equal(folderPlan.some((step) => /idx_file_scopes|sqlite_autoindex_file_scopes/.test(step.detail)), true);
    const namePlan = explainLibraryFilesQuery(db, { sort: 'name', order: 'ASC', limit: 20, offset: 0 });
    assert.equal(namePlan.some((step) => /idx_files_name/.test(step.detail)), true);
  } finally {
    db.close();
    fixture.cleanup();
  }
});
