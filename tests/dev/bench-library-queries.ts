import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';
import { createPerformanceDatabase } from '../support/fixtures/performanceFixtures';
import { backfillFileScopes } from '../../src/main/fileScopes';
import { getLibraryPage, explainLibraryPageQuery } from '../../src/main/libraryQueries';
import type { LibraryQuery } from '../../src/shared/libraryQuery';

const ARCHIVE_MARKER = '::entry::';
const WARMUPS = 5;
const SAMPLES = 25;

function percentile(values: number[], fraction: number) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

function summarize(values: number[]) {
  return {
    samples: values.length,
    medianMs: Number(percentile(values, 0.5).toFixed(2)),
    p95Ms: Number(percentile(values, 0.95).toFixed(2)),
  };
}

async function benchmark(count: number) {
  const fixture = createPerformanceDatabase({ count });
  const db = new Database(fixture.dbPath);
  const paths = db.prepare('SELECT id, path, directory, name FROM files ORDER BY id')
    .all() as Array<{ id: number; path: string; directory: string; name: string }>;
  const update = db.prepare('UPDATE files SET path = ?, directory = ?, archive_path = ? WHERE id = ?');
  const rewrite = db.transaction(() => {
    for (let index = 0; index < paths.length; index++) {
      // One fifth of the models are spread over groups of five archive entries.
      if (index % 5 !== 0) continue;
      const group = Math.floor(index / 25);
      const archivePath = path.join(fixture.root, 'archives', `bundle-${String(group).padStart(4, '0')}.zip`);
      const member = `parts/${paths[index].name}`;
      update.run(`${archivePath}${ARCHIVE_MARKER}${member}`, `${archivePath}${ARCHIVE_MARKER}parts`, archivePath, paths[index].id);
    }
  });
  rewrite();
  while (true) {
    const page = backfillFileScopes(db, 1000);
    if (page.complete) break;
  }

  const allPaths = db.prepare('SELECT path FROM files ORDER BY id').pluck().all() as string[];
  const grouped: LibraryQuery = {
    sort: 'name', direction: 'ASC', extension: null, folder: null, search: '',
    collectionPaths: null, limit: 500, offset: 0,
  };
  const collection: LibraryQuery = { ...grouped, collectionPaths: allPaths };
  const heartbeatIntervalMs = 10;
  let maxHeartbeatLagMs = 0;
  let expectedHeartbeat = performance.now() + heartbeatIntervalMs;
  const heartbeat = setInterval(() => {
    const now = performance.now();
    maxHeartbeatLagMs = Math.max(maxHeartbeatLagMs, now - expectedHeartbeat);
    expectedHeartbeat = now + heartbeatIntervalMs;
  }, heartbeatIntervalMs);

  async function measure(query: LibraryQuery) {
    for (let index = 0; index < WARMUPS; index++) getLibraryPage(db, query);
    const elapsed: number[] = [];
    for (let index = 0; index < SAMPLES; index++) {
      const start = performance.now();
      const result = getLibraryPage(db, query);
      elapsed.push(performance.now() - start);
      if (result.status !== 'ok' || result.items.length !== 500) throw new Error(`Unexpected page result for ${count}`);
      await delay(0);
    }
    return summarize(elapsed);
  }

  try {
    const groupedPlan = explainLibraryPageQuery(db, grouped).map((row) => row.detail);
    const collectionPlan = explainLibraryPageQuery(db, collection).map((row) => row.detail);
    const groupedStats = await measure(grouped);
    const collectionStats = await measure(collection);
    return {
      count,
      sqlite: db.prepare('SELECT sqlite_version() AS version').get() as { version: string },
      grouped: groupedStats,
      collection: collectionStats,
      maxHeartbeatLagMs: Number(maxHeartbeatLagMs.toFixed(2)),
      plans: { grouped: groupedPlan, collection: collectionPlan },
    };
  } finally {
    clearInterval(heartbeat);
    db.close();
    fixture.cleanup();
  }
}

async function main() {
  const results = [];
  for (const count of [10_000, 50_000]) results.push(await benchmark(count));
  console.log(JSON.stringify({
    runtime: process.version,
    platform: process.platform,
    arch: process.arch,
    warmups: WARMUPS,
    samples: SAMPLES,
    results,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
