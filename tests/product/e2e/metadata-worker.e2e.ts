import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchIsolatedApp } from '../../support/helpers/isolatedApp';

// October 2 user-approved provisional scan budgets; DB-WORKER-01 retains the 250ms reference goal.
const SCAN_HEARTBEAT_BUDGET_MS = process.platform === 'win32' ? 850 : process.platform === 'linux' ? 300 : 250;
const SCAN_HEARTBEAT_GATED = process.platform !== 'linux' && process.platform !== 'win32';

async function findMainWindow(app: Awaited<ReturnType<typeof launchIsolatedApp>>['app']) {
  await app.firstWindow();
  await expect.poll(async () => {
    for (const page of app.windows()) {
      if (await page.locator('#search-input').isVisible().catch(() => false)) return true;
    }
    return false;
  }, { timeout: 15_000 }).toBe(true);
  for (const page of app.windows()) {
    if (await page.locator('#search-input').isVisible().catch(() => false)) return page;
  }
  throw new Error('Visible main window did not become ready');
}

test('large OBJ metadata uses the utility worker and the app quits cleanly afterward', async () => {
  const env: NodeJS.ProcessEnv = {};
  let heartbeatPath = '';
  let libraryPath = '';
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(process.cwd(), 'out/main/index.js'),
    env,
    beforeLaunch: ({ scratchDir }) => {
      heartbeatPath = path.join(scratchDir, 'main-heartbeat.json');
      libraryPath = path.join(scratchDir, 'library');
      env.POLYTRAY_SCAN_TEST_HEARTBEAT_PATH = heartbeatPath;
      fs.mkdirSync(libraryPath);
      const fd = fs.openSync(path.join(libraryPath, 'large.obj'), 'w');
      try {
        const chunk = Array.from({ length: 20_000 }, (_, index) => `v ${index % 101} ${index % 73} ${index % 47}\n`).join('');
        for (let batch = 0; batch < 60; batch++) fs.writeSync(fd, chunk);
        fs.writeSync(fd, 'f 1 2 3\n');
      } finally { fs.closeSync(fd); }
    },
  });
  try {
    const window = await findMainWindow(isolated.app);
    await window.evaluate((root) => {
      const state = window as unknown as { __g02MetadataScan?: { done: boolean; result?: { state: string; metadataCompleted?: number }; error?: string } };
      state.__g02MetadataScan = { done: false };
      void window.polytray.scanFolder(root, {
        thumbnail_timeout: 10_000, scanning_batch_size: 10, watcher_stability: 500,
        page_size: 50, thumbnailColor: '#808080',
      }).then((result) => { state.__g02MetadataScan!.result = result; state.__g02MetadataScan!.done = true; }, (error) => {
        state.__g02MetadataScan!.error = String(error); state.__g02MetadataScan!.done = true;
      });
    }, libraryPath);
    const concurrentQuerySamples: number[] = [];
    let scanResult: { state: string; metadataCompleted?: number } | undefined;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const sample = await window.evaluate(async (root) => {
        const state = window as unknown as { __g02MetadataScan: { done: boolean; result?: { state: string; metadataCompleted?: number }; error?: string } };
        if (state.__g02MetadataScan.error) throw new Error(state.__g02MetadataScan.error);
        const jobs = await window.polytray.getBackgroundJobs();
        const job = jobs.find((candidate) => candidate.kind === 'scan' && candidate.rootPath === root);
        const extracting = Boolean(job && job.state === 'running' && job.counts.indexed > 0 && job.counts.metadataCompleted === 0);
        let queryMs: number | null = null;
        let queryStatus: string | null = null;
        if (extracting) {
          const started = performance.now();
          const page = await window.polytray.getLibraryPage({ sort: 'name', direction: 'ASC', extension: null, folder: root, search: '', collectionPaths: null, limit: 50, offset: 0 });
          queryMs = performance.now() - started;
          queryStatus = page.status;
        }
        const after = (await window.polytray.getBackgroundJobs()).find((candidate) => candidate.kind === 'scan' && candidate.rootPath === root);
        const remainedInExtraction = Boolean(extracting && after && after.state === 'running' && after.counts.metadataCompleted === 0);
        if (state.__g02MetadataScan.done) return { done: true, result: state.__g02MetadataScan.result, error: state.__g02MetadataScan.error, concurrent: false, queryMs, queryStatus };
        return { done: false, concurrent: remainedInExtraction, queryMs, queryStatus };
      }, libraryPath);
      if (sample.concurrent && sample.queryMs !== null) concurrentQuerySamples.push(sample.queryMs);
      if (sample.done) { scanResult = sample.result; break; }
    }
    expect(scanResult, 'large OBJ scan and metadata extraction finish').toBeTruthy();
    const result = scanResult!;
    expect(result.state).toBe('completed');
    expect(result.metadataCompleted).toBe(1);
    expect(concurrentQuerySamples.length).toBeGreaterThan(0);
    await expect.poll(() => fs.existsSync(heartbeatPath)).toBe(true);
    const heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8')) as {
      intervalMs: number; samples: number; maxGapMs: number | null;
    };
    expect(heartbeat.intervalMs).toBe(25);
    expect(heartbeat.samples).toBeGreaterThan(0);
    expect(heartbeat.maxGapMs).not.toBeNull();
    expect(Number.isFinite(heartbeat.maxGapMs)).toBe(true);
    expect(heartbeat.maxGapMs!).toBeGreaterThan(0);
    const heartbeatTargetMet = heartbeat.maxGapMs! <= SCAN_HEARTBEAT_BUDGET_MS;
    if (SCAN_HEARTBEAT_GATED) expect(heartbeat.maxGapMs!).toBeLessThanOrEqual(SCAN_HEARTBEAT_BUDGET_MS);
    else {
      // Keep every sample and slow phase in the CI log even when functional tests pass.
      console.info('[metadata-worker heartbeat performance report]', JSON.stringify({
        platform: process.platform, gate: 'report-only', budgetMs: SCAN_HEARTBEAT_BUDGET_MS,
        targetMet: heartbeatTargetMet, ...heartbeat,
      }));
      if (!heartbeatTargetMet) console.warn('[metadata-worker] SCAN heartbeat target MISSED; DB-WORKER-01 remains open');
    }
    const sortedQueries = [...concurrentQuerySamples].sort((a, b) => a - b);
    console.info('[G02 metadata query metrics]', JSON.stringify({
      concurrentSamples: concurrentQuerySamples.length,
      queryMedianMs: sortedQueries[Math.floor(sortedQueries.length / 2)],
      queryP95Ms: sortedQueries[Math.ceil(sortedQueries.length * 0.95) - 1],
      mainHeartbeatIntervalMs: heartbeat.intervalMs,
      mainHeartbeatSamples: heartbeat.samples,
      mainHeartbeatMaxGapMs: heartbeat.maxGapMs,
      mainHeartbeatBudgetMs: SCAN_HEARTBEAT_BUDGET_MS,
      mainHeartbeatGate: SCAN_HEARTBEAT_GATED ? 'gated' : 'report-only',
      mainHeartbeatTargetMet: heartbeatTargetMet,
    }));
  } finally {
    // Closing the isolated Electron app exercises metadata-worker shutdown on quit.
    await isolated.close();
  }
});
