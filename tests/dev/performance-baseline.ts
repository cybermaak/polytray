import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchIsolatedApp } from '../support/helpers/isolatedApp';
import { createProbeRecorder } from '../support/helpers/performanceProbe';
import type { LibraryPageResult } from '../../src/shared/libraryQuery';

interface PerformanceBridge extends Window {
  polytray: { getLibraryPage(query: { sort: 'name'; direction: 'ASC'; extension: null; folder: string; search: ''; collectionPaths: string[] | null; limit: number; offset: number }): Promise<LibraryPageResult> };
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
  let heartbeatPath = '';
  let scanRoot = '';
  let releasePath = '';
  let reachedPath = '';
  const env: NodeJS.ProcessEnv = {};
  const isolated = await launchIsolatedApp({
    mainEntry: path.resolve('out/main/index.js'),
    env,
    beforeLaunch: ({ userDataDir, scratchDir }) => {
      lastOnlyPath = (JSON.parse(runInElectronNode('tests/dev/seed-performance-database.ts', [String(count), userDataDir])) as { lastOnlyPath: string | null }).lastOnlyPath;
      scanRoot = path.join(scratchDir, 'heartbeat-library');
      heartbeatPath = path.join(scratchDir, 'query-main-heartbeat.json');
      releasePath = path.join(scratchDir, 'heartbeat-release');
      reachedPath = path.join(scratchDir, 'heartbeat-reached');
      fs.mkdirSync(path.join(scanRoot, 'a-first'), { recursive: true });
      fs.mkdirSync(path.join(scanRoot, 'z-held'), { recursive: true });
      fs.writeFileSync(path.join(scanRoot, 'a-first', 'seed.stl'), 'solid heartbeat\nendsolid heartbeat\n');
      env.POLYTRAY_SCAN_TEST_HEARTBEAT_PATH = heartbeatPath;
      env.POLYTRAY_SCAN_TEST_HOLD_PATH = path.join(scanRoot, 'z-held');
      env.POLYTRAY_SCAN_TEST_RELEASE_PATH = releasePath;
      env.POLYTRAY_SCAN_TEST_REACHED_PATH = reachedPath;
    },
  });
  try {
    const window = await isolated.app.firstWindow();
    await window.locator('#search-input').waitFor({ state: 'attached', timeout: 30_000 });
    const folder = path.join(isolated.userDataDir, 'library');
    await window.evaluate((root) => {
      const state = window as unknown as { __g02Scan?: { done: boolean; error?: string } };
      state.__g02Scan = { done: false };
      void window.polytray.scanFolder(root).then(() => { state.__g02Scan!.done = true; }, (error) => {
        state.__g02Scan!.error = String(error); state.__g02Scan!.done = true;
      });
    }, scanRoot);
    for (let attempt = 0; attempt < 300 && !fs.existsSync(reachedPath); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    if (!fs.existsSync(reachedPath)) throw new Error('Main heartbeat scan did not reach its hold barrier');
    const samples: number[] = [];
    let finalPage: { total: number; pageCount: number; lastPath?: string } | undefined;
    for (let i = 0; i < 25; i++) {
      const sample = await window.evaluate(async (folderPath) => {
        const started = performance.now();
        const page = await (window as unknown as PerformanceBridge).polytray.getLibraryPage({ sort: 'name', direction: 'ASC', extension: null, folder: folderPath, search: '', collectionPaths: null, limit: 500, offset: 0 });
        return { elapsedMs: performance.now() - started, total: page.status === 'ok' ? page.totalModels : 0, pageCount: page.status === 'ok' ? page.items.length : 0, totalItems: page.status === 'ok' ? page.totalItems : 0, archiveGroups: page.status === 'ok' ? page.items.filter((item) => item.kind === 'archive').length : 0 };
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
        const page = await (window as unknown as PerformanceBridge).polytray.getLibraryPage({ sort: 'name', direction: 'ASC', extension: null, folder: folderPath, search: '', collectionPaths, limit: 500, offset: 0 });
        return { elapsedMs: performance.now() - started, filteredCount: page.status === 'ok' ? page.totalModels : 0 };
      }, { folderPath: folder, collectionPaths });
      filteredCount = sample.filteredCount;
      if (i >= 5) collectionSamples.push(sample.elapsedMs);
    }
    const pageFiveHundred = count === 600 ? finalPage?.pageCount : undefined;
    const recorder = createProbeRecorder(isolated.scratchDir, `query-${count}.jsonl`);
    recorder.record('query-total', finalPage?.total ?? null);
    recorder.record('first-page-count', finalPage?.pageCount ?? null);
    recorder.record('last-only-membership-in-first-page', filteredCount);
    const planDiagnostics = JSON.parse(runInElectronNode('tests/dev/analyze-performance-query.ts', [isolated.userDataDir]));
    fs.writeFileSync(releasePath, 'release');
    await expectQueryScanToFinish(window);
    const heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8')) as { intervalMs: number; samples: number; maxGapMs: number | null };
    return {
      fixture: {
        records: count, folders: 40, folderFilter: true, archiveMemberShare: 0.2, archiveGroups: 12,
        queryFolder: folder, matchingRows: finalPage?.total ?? 0, matchingDisplayItems: finalPage?.totalItems ?? 0,
        order: 'name ASC', pageSize: 500, sortTiePattern: '7 sizes, 9 timestamps, 11 vertex-counts, 13 face-counts',
      },
      folderQuery: { timingClock: 'renderer performance.now around the awaited production IPC call', warmups: 5, samples: 20, ...summarize(samples) },
      lastOnlyCollection: { memberCount: 1, firstPageMatches: filteredCount, queryAndMembership: { warmups: 5, samples: 20, ...summarize(collectionSamples) } },
      productionQueryDiagnostic: planDiagnostics,
      mainHeartbeatDuringQueries: heartbeat,
      ...(count === 600 ? { displayedPageCount: pageFiveHundred, totalCount: finalPage?.total, lastRecordPath: lastOnlyPath } : {}),
    };
  } finally { await isolated.close(); }
}

async function expectQueryScanToFinish(window: import('playwright').Page) {
  await window.waitForFunction(() => (window as unknown as { __g02Scan?: { done: boolean } }).__g02Scan?.done === true, undefined, { timeout: 30_000 });
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
    query: 'Electron renderer -> preload IPC -> production GET_LIBRARY_PAGE scoped 500-item page; includes filtered model count, archive-summary grouping/counts, ordering, representative samples, and page selection.',
    collection: 'Production GET_LIBRARY_PAGE with last-only collectionPaths membership in SQLite.',
    mainHeartbeat: 'A separate isolated scan is held at a subtree barrier while the measured production query calls run; a 25 ms main-process heartbeat records gaps through scan completion.',
    idleHeartbeat: 'Not measured by the query harness; settled viewer frames are measured by the product E2E probe.',
    viewerFrames: 'The query harness does not collect viewer frames. installRendererProbe counts only explicit markViewerFrame calls after a real viewer render; it does not schedule animation frames. Draw calls are not treated as frame counts.',
  }, denseDiagnostic, results }, null, 2));
}

void main();
