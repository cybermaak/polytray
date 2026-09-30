import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchIsolatedApp } from '../support/helpers/isolatedApp';
import { createProbeRecorder } from '../support/helpers/performanceProbe';
import type { LibraryPageResult } from '../../src/shared/libraryQuery';

interface PerformanceBridge extends Window {
  polytray: {
    getLibraryPage(query: { sort: 'name'; direction: 'ASC'; extension: null; folder: string; search: ''; collectionPaths: string[] | null; limit: number; offset: number }): Promise<LibraryPageResult>;
    getFiles(options: { folder: string; sort: string; order: string; limit: number; offset: number }): Promise<{ files: Array<{ path: string }>; total: number }>;
  };
}

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], minMs: sorted[0], maxMs: sorted[sorted.length - 1] };
}

async function findVisibleMainWindow(app: Awaited<ReturnType<typeof launchIsolatedApp>>['app']) {
  const diagnostics: string[] = [];
  app.process().stderr?.on('data', (chunk) => diagnostics.push(String(chunk)));
  await app.firstWindow();
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const page of app.windows()) {
      try {
        await page.locator('#search-input').waitFor({ state: 'attached', timeout: 200 });
        return page;
      } catch {
        // The detached thumbnail renderer has no main-window search control.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Visible main window did not become ready${diagnostics.length ? `\n${diagnostics.join('')}` : ''}`);
}

function runInElectronNode(scriptPath: string, args: string[]) {
  const result = spawnSync(require('electron'), ['--import', 'tsx', path.resolve(scriptPath), ...args], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  if (result.status !== 0) throw new Error(`Electron runtime helper failed (${scriptPath}): ${result.stderr}`);
  return result.stdout.trim();
}

async function runAppQueryBenchmark(
  count: number,
  shape: 'flat' | 'grouped',
  options: { scopeIndex?: 'incomplete' | 'ready'; readinessOnly?: boolean; probeLegacyDuringBackfill?: boolean } = {},
) {
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
      lastOnlyPath = (JSON.parse(runInElectronNode('tests/dev/seed-performance-database.ts', [
        String(count), userDataDir, shape, options.scopeIndex ?? 'incomplete',
      ])) as { lastOnlyPath: string | null }).lastOnlyPath;
      if (options.readinessOnly) return;
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
    const window = await findVisibleMainWindow(isolated.app);
    const folder = path.join(isolated.userDataDir, 'library');
    const coldReadyAt = await window.evaluate(() => performance.now());
    let startupFirstCardMs: number | undefined;
    let scopeStateAtFirstCard: unknown;
    if (options.readinessOnly) {
      await window.locator('.file-card .card-name').first().waitFor({ state: 'visible', timeout: 30_000 });
      startupFirstCardMs = await window.evaluate((readyAt) => performance.now() - readyAt, coldReadyAt);
      scopeStateAtFirstCard = JSON.parse(runInElectronNode('tests/dev/read-scope-index-state.ts', [isolated.userDataDir]));
    }
    await window.evaluate(async ({ root, folderPath, readyAt, probeLegacyDuringBackfill }) => {
      const state = window as unknown as {
        __g02Scan?: { done: boolean; error?: string };
        __g02ColdReadyAt?: number;
        __g02ColdPage?: { elapsedMs: number; readyToRequestMs: number; readyToResponseMs: number; status: string; totalModels: number | null; totalItems: number | null };
        __g02LegacyBrowse?: { elapsedMs: number; total: number; pageSize: number; pagePendingAtResponse: boolean };
      };
      state.__g02ColdReadyAt = readyAt;
      if (root) {
        state.__g02Scan = { done: false };
        void window.polytray.scanFolder(root).then(() => { state.__g02Scan!.done = true; }, (error) => {
          state.__g02Scan!.error = String(error); state.__g02Scan!.done = true;
        });
      }
      // In the regular baseline, the held scan starts the heartbeat before the
      // first browse request. Readiness-only captures rely on app startup alone.
      const requestAt = performance.now();
      void (window as unknown as PerformanceBridge).polytray.getLibraryPage({
        sort: 'name', direction: 'ASC', extension: null, folder: folderPath,
        search: '', collectionPaths: null, limit: 500, offset: 0,
      }).then((page) => {
        const respondedAt = performance.now();
        state.__g02ColdPage = {
          elapsedMs: respondedAt - requestAt,
          readyToRequestMs: requestAt - readyAt,
          readyToResponseMs: respondedAt - readyAt,
          status: page.status,
          totalModels: page.status === 'ok' ? page.totalModels : null,
          totalItems: page.status === 'ok' ? page.totalItems : null,
        };
      });
      if (probeLegacyDuringBackfill) {
        const legacyStarted = performance.now();
        const legacy = await (window as unknown as PerformanceBridge).polytray.getFiles({
          folder: '', sort: 'name', order: 'ASC', limit: 200, offset: 0,
        });
        state.__g02LegacyBrowse = {
          elapsedMs: performance.now() - legacyStarted,
          total: legacy.total,
          pageSize: legacy.files.length,
          pagePendingAtResponse: state.__g02ColdPage === undefined,
        };
      }
    }, {
      root: options.readinessOnly ? '' : scanRoot,
      folderPath: folder,
      readyAt: coldReadyAt,
      probeLegacyDuringBackfill: options.probeLegacyDuringBackfill === true,
    });
    if (!options.readinessOnly) {
      for (let attempt = 0; attempt < 300 && !fs.existsSync(reachedPath); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
      if (!fs.existsSync(reachedPath)) throw new Error('Main heartbeat scan did not reach its hold barrier');
    }
    let legacyBrowseDuringBackfill: unknown;
    if (options.readinessOnly && options.probeLegacyDuringBackfill) {
      legacyBrowseDuringBackfill = await window.evaluate(() => (window as unknown as { __g02LegacyBrowse?: unknown }).__g02LegacyBrowse);
      const legacy = legacyBrowseDuringBackfill as { total?: number; pageSize?: number; pagePendingAtResponse?: boolean } | undefined;
      if (legacy?.total !== count || legacy.pageSize !== 200) {
        throw new Error(`Legacy GET_FILES did not preserve the expected library page: ${JSON.stringify(legacy)}`);
      }
    }
    for (let attempt = 0; attempt < 300; attempt++) {
      const coldPageComplete = await window.evaluate(() => Boolean((window as unknown as { __g02ColdPage?: unknown }).__g02ColdPage));
      if (coldPageComplete) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const firstPageFromReady = await window.evaluate(() => (window as unknown as {
      __g02ColdPage: { elapsedMs: number; readyToRequestMs: number; readyToResponseMs: number; status: string; totalModels: number | null; totalItems: number | null };
    }).__g02ColdPage);
    if (!firstPageFromReady) throw new Error('Cold GET_LIBRARY_PAGE did not settle while heartbeat scan was held');
    if (options.readinessOnly) {
      return {
        fixture: { records: count, fixtureShape: shape, scopeIndexAtSeed: options.scopeIndex ?? 'incomplete' },
        startupFirstCardMs,
        scopeStateAtFirstCard,
        coldFirstGetLibraryPageFromReady: firstPageFromReady,
        ...(legacyBrowseDuringBackfill === undefined ? {} : { legacyBrowseDuringBackfill }),
      };
    }
    const samples: number[] = [];
    let finalPage: { total: number; pageCount: number; totalItems: number | null; archiveGroups: number } | undefined;
    for (let i = 0; i < 25; i++) {
      const sample = await window.evaluate(async ({ folderPath, shape }) => {
        const started = performance.now();
        const bridge = window as unknown as PerformanceBridge;
        if (shape === 'grouped') {
          const page = await bridge.polytray.getLibraryPage({ sort: 'name', direction: 'ASC', extension: null, folder: folderPath, search: '', collectionPaths: null, limit: 500, offset: 0 });
          return { elapsedMs: performance.now() - started, total: page.status === 'ok' ? page.totalModels : 0, pageCount: page.status === 'ok' ? page.items.length : 0, totalItems: page.status === 'ok' ? page.totalItems : null, archiveGroups: page.status === 'ok' ? page.items.filter((item) => item.kind === 'archive').length : 0 };
        }
        const page = await bridge.polytray.getFiles({ folder: folderPath, sort: 'name', order: 'ASC', limit: 500, offset: 0 });
        return { elapsedMs: performance.now() - started, total: page.total, pageCount: page.files.length, totalItems: null, archiveGroups: 0 };
      }, { folderPath: folder, shape });
      finalPage = sample;
      if (i >= 5) samples.push(sample.elapsedMs);
    }
    const collectionSamples: number[] = [];
    let filteredCount = 0;
    const collectionPaths: string[] = lastOnlyPath ? [lastOnlyPath] : [];
    for (let i = 0; i < 25; i++) {
      const sample = await window.evaluate(async ({ folderPath, collectionPaths, shape }) => {
        const started = performance.now();
        const bridge = window as unknown as PerformanceBridge;
        if (shape === 'grouped') {
          const page = await bridge.polytray.getLibraryPage({ sort: 'name', direction: 'ASC', extension: null, folder: folderPath, search: '', collectionPaths, limit: 500, offset: 0 });
          return { elapsedMs: performance.now() - started, filteredCount: page.status === 'ok' ? page.totalModels : 0 };
        }
        const page = await bridge.polytray.getFiles({ folder: folderPath, sort: 'name', order: 'ASC', limit: 500, offset: 0 });
        return { elapsedMs: performance.now() - started, filteredCount: page.files.filter((file) => collectionPaths.includes(file.path)).length };
      }, { folderPath: folder, collectionPaths, shape });
      filteredCount = sample.filteredCount;
      if (i >= 5) collectionSamples.push(sample.elapsedMs);
    }
    const pageFiveHundred = count === 600 ? finalPage?.pageCount : undefined;
    const recorder = createProbeRecorder(isolated.scratchDir, `query-${shape}-${count}.jsonl`);
    recorder.record('query-total', finalPage?.total ?? null);
    recorder.record('first-page-count', finalPage?.pageCount ?? null);
    recorder.record('last-only-membership-in-first-page', filteredCount);
    const planDiagnostics = JSON.parse(runInElectronNode('tests/dev/analyze-performance-query.ts', [isolated.userDataDir, shape]));
    fs.writeFileSync(releasePath, 'release');
    await expectQueryScanToFinish(window);
    const heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8')) as { intervalMs: number; samples: number; maxGapMs: number | null };
    return {
      fixture: {
        records: count, folders: 40, folderFilter: true, fixtureShape: shape,
        archiveMemberShare: shape === 'grouped' ? 0.2 : 0, archiveGroups: shape === 'grouped' ? 12 : 0,
        queryFolder: folder, matchingRows: finalPage?.total ?? 0, matchingDisplayItems: finalPage?.totalItems,
        order: 'name ASC', pageSize: 500, sortTiePattern: '7 sizes, 9 timestamps, 11 vertex-counts, 13 face-counts',
      },
      coldFirstGetLibraryPageFromReady: {
        clock: 'renderer performance.now around the first GET_LIBRARY_PAGE after search-input readiness; isolated scan IPC is queued immediately beforehand to start the 25ms main heartbeat, and this sample is excluded from warmups and warm query samples',
        ...firstPageFromReady,
      },
      folderQuery: { timingClock: 'renderer performance.now around the awaited production IPC call', warmups: 5, samples: 20, ...summarize(samples) },
      lastOnlyCollection: { memberCount: 1, firstPageMatches: shape === 'flat' ? filteredCount : null, matchingModelCount: shape === 'grouped' ? filteredCount : null, queryAndMembership: { warmups: 5, samples: 20, ...summarize(collectionSamples) } },
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
  if (process.argv.includes('--scope-index-readiness-only')) {
    const duringBackfill = await runAppQueryBenchmark(50_000, 'grouped', {
      scopeIndex: 'incomplete', readinessOnly: true, probeLegacyDuringBackfill: true,
    });
    const preseeded = await runAppQueryBenchmark(50_000, 'grouped', {
      scopeIndex: 'ready', readinessOnly: true,
    });
    console.log(JSON.stringify({ capturedAt: new Date().toISOString(), scopeIndexReadiness: { duringBackfill, preseeded } }, null, 2));
    return;
  }
  const denseDiagnostic = JSON.parse(runInElectronNode('tests/dev/run-dense-model-diagnostic.ts', []));
  const results = [];
  for (const shape of ['flat', 'grouped'] as const) for (const count of [600, 10_000, 50_000]) results.push(await runAppQueryBenchmark(count, shape));
  console.log(JSON.stringify({ capturedAt: new Date().toISOString(), environment: {
    platform: process.platform, arch: process.arch, os: `${os.type()} ${os.release()}`, cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model, memoryBytes: os.totalmem(), node: process.version, electron: process.versions.electron,
    sqlite: process.versions.sqlite ?? 'Electron bundled SQLite',
  }, methodology: {
    warmups: 5, measuredSamples: 20,
    flatF02Parity: 'Electron renderer -> preload IPC -> legacy GET_FILES folder branch -> 500-row page; then renderer-side last-only collectionPaths.includes filtering on returned page. Fixture has 40 folders and no archive_path values.',
    groupedProductionShape: 'Electron renderer -> preload IPC -> production GET_LIBRARY_PAGE scoped 500-item page; includes filtered model count, display-item count, archive grouping/counts, ordering, representative samples, and page selection. Fixture has 20% archive membership across 12 groups.',
    phaseDiagnostics: 'Electron Node 20.19.1 performance.now around synchronous get/all calls inside the unchanged production getLibraryPage function; five warmups plus 20 measured calls per categorized statement; excludes IPC and JS/temp-table work between statements.',
    coldReadiness: 'One first getLibraryPage request immediately after the visible search input is attached; an isolated scan IPC is queued first in the same renderer task to start the 25ms main heartbeat. Cold call is excluded from warmups and query samples and includes production scope-index readiness wait if one is still pending.',
    collection: 'Flat shape repeats F02 renderer membership predicate; grouped shape uses GET_LIBRARY_PAGE collectionPaths membership in SQLite.',
    mainHeartbeat: 'A separate isolated scan is held at a subtree barrier while the measured production query calls run; a 25 ms main-process heartbeat records gaps through scan completion.',
    idleHeartbeat: 'Not measured by the query harness; settled viewer frames are measured by the product E2E probe.',
    viewerFrames: 'The query harness does not collect viewer frames. installRendererProbe counts only explicit markViewerFrame calls after a real viewer render; it does not schedule animation frames. Draw calls are not treated as frame counts.',
  }, denseDiagnostic, results: results.map((result) => ({
    ...result,
    mainHeartbeatDuringQueries: result.mainHeartbeatDuringQueries && {
      intervalMs: result.mainHeartbeatDuringQueries.intervalMs,
      samples: result.mainHeartbeatDuringQueries.samples,
      maxGapMs: result.mainHeartbeatDuringQueries.maxGapMs,
    },
  })) }, null, 2));
}

void main();
