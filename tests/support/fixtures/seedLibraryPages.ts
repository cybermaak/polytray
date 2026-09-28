import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { create600Database } from './performanceFixtures';
import { createArchiveEntryPath, ARCHIVE_ENTRY_SEPARATOR } from '../../../src/shared/archivePaths';

const userDataDir = process.argv[2];
if (!userDataDir) throw new Error('Expected the isolated app userData directory');

const fixture = create600Database(userDataDir);
fs.mkdirSync(path.join(fixture.root, 'library'), { recursive: true });
const thumbnailTestFolder = path.join(fixture.root, 'library', 'thumbnail-fixture');
fs.mkdirSync(thumbnailTestFolder, { recursive: true });
const thumbnailTestPath = path.join(thumbnailTestFolder, 'test_model_a.stl');
fs.copyFileSync(path.join(process.cwd(), 'tests/support/fixtures/test_model_a.stl'), thumbnailTestPath);
const thumbnailTestStat = fs.statSync(thumbnailTestPath);
const db = new Database(fixture.dbPath);
const archivePath = path.join(fixture.root, 'library', 'many-models.zip');
const rows = db.prepare('SELECT id, path, name FROM files ORDER BY id').all() as Array<{ id: number; path: string; name: string }>;
const update = db.prepare('UPDATE files SET path = ?, name = ?, directory = ?, archive_path = ? WHERE id = ?');
const updateThumbnailFixture = db.prepare(`UPDATE files SET path = ?, name = ?, extension = 'stl', directory = ?,
  size_bytes = ?, modified_at = ?, archive_path = NULL, thumbnail = NULL, thumbnail_failed = 0 WHERE id = ?`);
const mutate = db.transaction(() => {
  for (let index = 0; index < 520; index += 1) {
    const row = rows[index];
    const entryName = `member-${String(index).padStart(5, '0')}.stl`;
    const displayName = index >= 498 && index <= 500 ? 'member-00498.stl' : entryName;
    update.run(
      createArchiveEntryPath(archivePath, entryName),
      displayName,
      `${archivePath}${ARCHIVE_ENTRY_SEPARATOR}`,
      archivePath,
      row.id,
    );
  }
});
mutate();
updateThumbnailFixture.run(thumbnailTestPath, path.basename(thumbnailTestPath, '.stl'), thumbnailTestFolder, thumbnailTestStat.size,
  Math.floor(thumbnailTestStat.mtimeMs), rows[599].id);
const updatedRows = db.prepare('SELECT id, path, name FROM files ORDER BY id').all() as Array<{ id: number; path: string; name: string }>;
const collectionPaths = updatedRows.map((row) => row.path);
db.close();

console.log(JSON.stringify({
  libraryRoot: path.join(fixture.root, 'library'),
  archivePath,
  archiveModelCount: 520,
  collectionPaths,
  lastRecordPath: updatedRows[599].path,
  lastRecordName: updatedRows[599].name,
  thumbnailTestFolder,
  thumbnailTestPath,
  thumbnailTestFileId: updatedRows[599].id,
  tieFileIds: [rows[498].id, rows[499].id, rows[500].id],
}));
