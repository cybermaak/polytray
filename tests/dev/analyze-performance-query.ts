import Database from 'better-sqlite3';
import path from 'node:path';
import { explainLibraryPageQuery, getLibraryPage } from '../../src/main/libraryQueries';

const userDataDir = process.argv[2];
if (!userDataDir) throw new Error('Expected isolated app userData directory');
const db = new Database(path.join(userDataDir, 'data', 'polytray.db'));
try {
  const query = {
    sort: 'name' as const, direction: 'ASC' as const, extension: null, folder: path.join(userDataDir, 'library'),
    search: '', collectionPaths: null, limit: 500, offset: 0,
  };
  const plan = explainLibraryPageQuery(db, query).map((step) => step.detail);
  const started = performance.now();
  const page = getLibraryPage(db, query);
  const elapsedMs = performance.now() - started;
  console.log(JSON.stringify({ elapsedMs, plan, status: page.status,
    totalModels: page.status === 'ok' ? page.totalModels : null,
    totalItems: page.status === 'ok' ? page.totalItems : null,
    archiveGroupsInPage: page.status === 'ok' ? page.items.filter((item) => item.kind === 'archive').length : null,
  }));
} finally { db.close(); }
