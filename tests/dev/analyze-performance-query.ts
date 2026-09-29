import Database from 'better-sqlite3';
import path from 'node:path';
import { explainLibraryFilesQuery, explainLibraryPageQuery, getLibraryPage } from '../../src/main/libraryQueries';

const userDataDir = process.argv[2];
const shape = process.argv[3] ?? 'grouped';
if (!userDataDir || !['flat', 'grouped'].includes(shape)) throw new Error('Expected isolated app userData directory and flat|grouped shape');
const db = new Database(path.join(userDataDir, 'data', 'polytray.db'));
try {
  const folder = path.join(userDataDir, 'library');
  if (shape === 'flat') {
    const queryPlan = explainLibraryFilesQuery(db, { folder, sort: 'name', order: 'ASC', limit: 500, offset: 0 }).map((step) => step.detail);
    console.log(JSON.stringify({ shape, queryPlan }));
  } else {
  const query = {
    sort: 'name' as const, direction: 'ASC' as const, extension: null, folder: path.join(userDataDir, 'library'),
    search: '', collectionPaths: null, limit: 500, offset: 0,
  };
  const plan = explainLibraryPageQuery(db, query).map((step) => step.detail);
  const phases: Record<string, number[]> = { pageCountsGroupingAndSelection: [], archiveRepresentativeSamples: [] };
  const classify = (sql: string) => sql.includes('SELECT display_items.*') ? 'pageCountsGroupingAndSelection'
      : sql.includes('ROW_NUMBER() OVER (PARTITION BY f.archive_path') ? 'archiveRepresentativeSamples'
        : null;
  const dbWithPrepare = db as unknown as { prepare(sql: string): Record<string, (...args: unknown[]) => unknown> };
  const originalPrepare = dbWithPrepare.prepare.bind(db);
  dbWithPrepare.prepare = (sql: string) => {
    const statement = originalPrepare(sql);
    const phase = classify(sql);
    if (!phase) return statement;
    for (const method of ['get', 'all'] as const) {
      const unboundOriginal = statement[method];
      if (!unboundOriginal) continue;
      const original = unboundOriginal.bind(statement);
      statement[method] = (...args: unknown[]) => {
        const started = performance.now();
        try { return original(...args); }
        finally { phases[phase].push(performance.now() - started); }
      };
    }
    return statement;
  };
  const aggregate: number[] = [];
  let finalPage: ReturnType<typeof getLibraryPage> | undefined;
  for (let iteration = 0; iteration < 25; iteration++) {
    const started = performance.now();
    finalPage = getLibraryPage(db, query);
    aggregate.push(performance.now() - started);
  }
  const summarize = (values: number[]) => {
    const measured = values.length > 5 ? values.slice(5) : values;
    const sorted = [...measured].sort((a, b) => a - b);
    return { calls: values.length, warmups: values.length > 5 ? 5 : 0, samples: measured.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] };
  };
  const page = finalPage;
  console.log(JSON.stringify({ shape, plan, repetitions: { warmups: 5, measured: 20 },
    phaseClock: 'Electron Node performance.now around synchronous get/all calls inside the unchanged production getLibraryPage function; excludes IPC and inter-statement JavaScript/temporary-table work',
    aggregateFunctionMs: summarize(aggregate), phaseStatementMs: Object.fromEntries(Object.entries(phases).map(([key, values]) => [key, summarize(values)])),
    status: page?.status, totalModels: page?.status === 'ok' ? page.totalModels : null,
    totalItems: page?.status === 'ok' ? page.totalItems : null,
    archiveGroupsInPage: page?.status === 'ok' ? page.items.filter((item) => item.kind === 'archive').length : null,
  }));
  }
} finally { db.close(); }
