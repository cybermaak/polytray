import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchIsolatedApp } from '../support/helpers/isolatedApp';
import { createProbeRecorder } from '../support/helpers/performanceProbe';

interface QueryResult { files: Array<{ path: string }>; total: number; }
interface PerformanceBridge extends Window {
  polytray: { getFiles(options: { folder: string; sort: string; order: string; limit: number; offset: number }): Promise<QueryResult> };
}

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], minMs: sorted[0], maxMs: sorted[sorted.length - 1] };
}

function runInElectronNode(scriptPath: string, args: string[]) {
  const result = spawnSync(require('electron'), ['--import', 'tsx', path.resolve(scriptPath), ...args], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  if (result.status !== 0) throw new Error(`Electron runtime helper failed (${scriptPath}): ${result.stderr}`);
  return result.stdout.trim();
}

async function runAppQueryBenchmark(count: number) {
  let lastOnlyPath: string | null = null;
  const isolated = await launchIsolatedApp({
    mainEntry: path.resolve('out/main/index.js'),
    beforeLaunch: ({ userDataDir }) => {
      lastOnlyPath = (JSON.parse(runInElectronNode('tests/dev/seed-performance-database.ts', [String(count), userDataDir])) as { lastOnlyPath: string | null }).lastOnlyPath;
    },
  });
  try {
    const window = await isolated.app.firstWindow();
    await window.locator('#search-input').waitFor({ state: 'attached', timeout: 30_000 });
    const folder = path.join(isolated.userDataDir, 'library');
    const samples: number[] = [];
    let finalPage: { total: number; pageCount: number; lastPath?: string } | undefined;
    for (let i = 0; i < 25; i++) {
      const sample = await window.evaluate(async (folderPath) => {
        const started = performance.now();
        const page = await (window as unknown as PerformanceBridge).polytray.getFiles({ folder: folderPath, sort: 'name', order: 'ASC', limit: 500, offset: 0 });
        return { elapsedMs: performance.now() - started, total: page.total, pageCount: page.files.length, lastPath: page.files.at(-1)?.path };
      }, folder);
      finalPage = sample;
      if (i >= 5) samples.push(sample.elapsedMs);
    }
    const collectionSamples: number[] = [];
    let filteredCount = 0;
    const collectionPaths: string[] = lastOnlyPath ? [lastOnlyPath] : [];
    for (let i = 0; i < 25; i++) {
      const sample = await window.evaluate(async ({ folderPath, collectionPaths }) => {
        const started = performance.now();
        const page = await (window as unknown as PerformanceBridge).polytray.getFiles({ folder: folderPath, sort: 'name', order: 'ASC', limit: 500, offset: 0 });
        return { elapsedMs: performance.now() - started, filteredCount: page.files.filter((file) => collectionPaths.includes(file.path)).length };
      }, { folderPath: folder, collectionPaths });
      filteredCount = sample.filteredCount;
      if (i >= 5) collectionSamples.push(sample.elapsedMs);
    }
    const pageFiveHundred = count === 600 ? finalPage?.pageCount : undefined;
    const recorder = createProbeRecorder(isolated.scratchDir, `query-${count}.jsonl`);
    recorder.record('query-total', finalPage?.total ?? null);
    recorder.record('first-page-count', finalPage?.pageCount ?? null);
    recorder.record('last-only-membership-in-first-page', filteredCount);
    return {
      fixture: {
        records: count, folders: 40, folderFilter: true,
        queryFolder: folder, matchingRows: finalPage?.total ?? 0,
        order: 'name ASC', pageSize: 500, sortTiePattern: '7 sizes, 9 timestamps, 11 vertex-counts, 13 face-counts',
      },
      folderQuery: { timingClock: 'renderer performance.now around the awaited production IPC call', warmups: 5, samples: 20, ...summarize(samples) },
      lastOnlyCollection: { memberCount: 1, firstPageMatches: filteredCount, queryAndMembership: { warmups: 5, samples: 20, ...summarize(collectionSamples) } },
      ...(count === 600 ? { displayedPageCount: pageFiveHundred, totalCount: finalPage?.total, lastRecordPath: lastOnlyPath } : {}),
    };
  } finally { await isolated.close(); }
}

async function main() {
  const denseDiagnostic = JSON.parse(runInElectronNode('tests/dev/run-dense-model-diagnostic.ts', []));
  const results = [];
  for (const count of [600, 10_000, 50_000]) results.push(await runAppQueryBenchmark(count));
  console.log(JSON.stringify({ capturedAt: new Date().toISOString(), environment: {
    platform: process.platform, arch: process.arch, os: `${os.type()} ${os.release()}`, cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model, memoryBytes: os.totalmem(), node: process.version, electron: process.versions.electron,
    sqlite: process.versions.sqlite ?? 'Electron bundled SQLite',
  }, methodology: {
    warmups: 5, measuredSamples: 20,
    query: 'Electron renderer -> preload IPC -> production GET_FILES folder branch -> 500 row page; includes folder containment and JavaScript sort.',
    collection: 'Same first page plus the renderer active-collection file-path membership predicate, using the last-only collection fixture.',
    idleHeartbeat: 'Not measured by this query benchmark; main heartbeat, renderer long tasks and actual viewer-frame hooks are separate probes.',
    viewerFrames: 'Unavailable in this run. installRendererProbe counts only explicit markViewerFrame calls after a real viewer render; it does not schedule animation frames. Draw calls are not treated as frame counts.',
  }, denseDiagnostic, results }, null, 2));
}

void main();
