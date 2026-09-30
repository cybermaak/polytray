import path from 'node:path';
import Database from 'better-sqlite3';

const userDataDir = process.argv[2];
if (!userDataDir) throw new Error('Expected the isolated Electron user-data directory');
const db = new Database(path.join(userDataDir, 'data', 'polytray.db'), { readonly: true, fileMustExist: true });
try {
  const backfill = db.prepare('SELECT cursor_file_id AS cursorFileId, complete FROM scope_backfill WHERE singleton = 1')
    .get() as { cursorFileId: number; complete: number };
  const rows = db.prepare('SELECT COUNT(*) AS count FROM files').get() as { count: number };
  const scopes = db.prepare('SELECT COUNT(*) AS count FROM file_scopes').get() as { count: number };
  console.log(JSON.stringify({ complete: backfill.complete === 1, cursorFileId: backfill.cursorFileId, fileCount: rows.count, scopeRowCount: scopes.count }));
} finally { db.close(); }
