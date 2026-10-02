import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchIsolatedApp } from '../../support/helpers/isolatedApp';
import { attachJsonFailureEvidence } from '../../support/helpers/failureEvidence';
import { LIBRARY_STATE_STORAGE_KEY } from '../../../src/shared/libraryState';
import { SETTINGS_STORAGE_KEY } from '../../../src/shared/settings';

// October 1 user-approved temporary Windows scan allowance; DB-WORKER-01 retains the 250ms goal.
const SCAN_HEARTBEAT_BUDGET_MS = process.platform === 'win32' ? 400 : 250;

async function findVisibleMainWindow(app: Awaited<ReturnType<typeof launchIsolatedApp>>['app']) {
  await app.firstWindow();
  await expect.poll(async () => {
    for (const page of app.windows()) {
      try {
        await page.locator('#search-input').waitFor({ timeout: 200 });
        return true;
      } catch { /* Ignore the hidden thumbnail renderer. */ }
    }
    return false;
  }, { timeout: 10_000 }).toBe(true);
  for (const page of app.windows()) {
    if (await page.locator('#search-input').isVisible().catch(() => false)) return page;
  }
  throw new Error('Visible main window did not become ready');
}

test('a 5k scan exposes the first indexed subtree before discovery completes', async () => {
  test.setTimeout(180_000);
  let root = '';
  let firstDirectory = '';
  let delayedDirectory = '';
  let firstPath = '';
  let releasePath = '';
  let reachedPath = '';
  let heartbeatPath = '';
  let queueMetricsPath = '';
  const env: NodeJS.ProcessEnv = {};
  let isolated: Awaited<ReturnType<typeof launchIsolatedApp>> | null = null;
  try {
    isolated = await launchIsolatedApp({
      mainEntry: path.join(process.cwd(), 'out/main/index.js'),
      env,
      beforeLaunch: ({ scratchDir }) => {
        root = path.join(scratchDir, 'library');
        firstDirectory = path.join(root, 'a-first');
        delayedDirectory = path.join(root, 'z-delayed');
        firstPath = path.join(firstDirectory, 'first.stl');
        releasePath = path.join(scratchDir, 'scan-release');
        reachedPath = path.join(scratchDir, 'scan-held');
        heartbeatPath = path.join(scratchDir, 'main-heartbeat.json');
        queueMetricsPath = path.join(scratchDir, 'scan-queue-metrics.json');
        fs.mkdirSync(firstDirectory, { recursive: true });
        fs.mkdirSync(delayedDirectory, { recursive: true });
        fs.writeFileSync(firstPath, 'solid first\nendsolid first\n');
        for (let index = 0; index < 4_999; index++) {
          fs.writeFileSync(path.join(delayedDirectory, `model-${String(index).padStart(5, '0')}.stl`), 'solid model\nendsolid model\n');
        }
        env.POLYTRAY_SCAN_TEST_HOLD_PATH = delayedDirectory;
        env.POLYTRAY_SCAN_TEST_RELEASE_PATH = releasePath;
        env.POLYTRAY_SCAN_TEST_REACHED_PATH = reachedPath;
        env.POLYTRAY_SCAN_TEST_HEARTBEAT_PATH = heartbeatPath;
        env.POLYTRAY_SCAN_QUEUE_METRICS = '1';
      },
    });
    let window = await findVisibleMainWindow(isolated.app);
    await window.evaluate(({ root, libraryStateKey, settingsKey }) => {
      localStorage.setItem(libraryStateKey, JSON.stringify({ libraryFolders: [root], lastFolder: root }));
      localStorage.setItem(settingsKey, JSON.stringify({ autoScan: false }));
    }, { root, libraryStateKey: LIBRARY_STATE_STORAGE_KEY, settingsKey: SETTINGS_STORAGE_KEY });
    await window.reload();
    window = await findVisibleMainWindow(isolated.app);
    await window.evaluate(({ firstDirectory, root }) => {
      const view = window as unknown as Window & {
        __scanStartedAt?: number;
        __scanFinished?: boolean;
        __scanResult?: { totalFiles: number };
        __scanError?: string;
        __scanProgress?: Array<{ at: number; total: number | null; indexed: number; discovered: number }>;
        __scanProof?: { total: number | null; indexed: number; elapsedMs: number; paths: string[]; unfinishedAtQuery: boolean };
      };
      view.__scanStartedAt = performance.now();
      view.__scanFinished = false;
      view.__scanProgress = [];
      let queried = false;
      window.polytray.onScanProgress((progress) => {
        view.__scanProgress!.push({ at: performance.now(), total: progress.total, indexed: progress.indexed ?? progress.current, discovered: progress.discovered ?? 0 });
        if (queried || progress.total !== null || !progress.indexed) return;
        queried = true;
        void window.polytray.getFiles({ folder: firstDirectory, limit: 10, offset: 0 }).then((result) => {
          const elapsedMs = performance.now() - (view.__scanStartedAt ?? performance.now());
          view.__scanProof = {
            total: progress.total,
            indexed: progress.indexed ?? progress.current,
            elapsedMs,
            paths: result.files.map((file) => file.path),
            unfinishedAtQuery: view.__scanFinished === false,
          };
        });
      });
      void window.polytray.scanFolder(root, {
        thumbnail_timeout: 20_000, scanning_batch_size: 50, watcher_stability: 1_000,
        page_size: 500, thumbnailColor: '#8888aa',
      }).then(
        (result) => { view.__scanResult = result; view.__scanFinished = true; },
        (error) => { view.__scanError = String(error); view.__scanFinished = true; },
      );
    }, { firstDirectory, root });

    await expect.poll(() => fs.existsSync(reachedPath)).toBe(true);
    await expect.poll(async () => window.evaluate(() => Boolean((window as unknown as { __scanProof?: unknown }).__scanProof)))
      .toBe(true);
    const proof = await window.evaluate(() => (window as unknown as {
      __scanProof: { total: number | null; indexed: number; elapsedMs: number; paths: string[]; unfinishedAtQuery: boolean };
      __scanFinished: boolean;
    }).__scanProof);
    expect(proof.total).toBeNull();
    expect(proof.indexed).toBeGreaterThan(0);
    expect(proof.paths).toContain(firstPath);
    expect(proof.unfinishedAtQuery).toBe(true);
    expect(fs.existsSync(releasePath)).toBe(false);
    expect(proof.elapsedMs).toBeLessThan(1_000);
    await expect(window.locator('.file-card .card-name[title="first"]')).toBeVisible({ timeout: 1_000 });
    const firstVisibleCardMs = await window.evaluate(() => performance.now() - ((window as unknown as { __scanStartedAt: number }).__scanStartedAt));
    expect(firstVisibleCardMs).toBeLessThan(1_000);
    expect(fs.existsSync(releasePath), 'the first file card is visible before the held subtree is released').toBe(false);
    const progressBeforeRelease = await window.evaluate(() => (window as unknown as {
      __scanProgress: Array<{ at: number; total: number | null; indexed: number; discovered: number }>;
    }).__scanProgress);

    const releasedAt = Date.now();
    fs.writeFileSync(releasePath, 'release');
    try {
      // Early visibility stays strict; hosted Windows was still indexing cleanly at 2,951/5,000 after 30 seconds.
      await expect.poll(async () => window.evaluate(() => (window as unknown as { __scanFinished: boolean }).__scanFinished),
        { timeout: 90_000 })
        .toBe(true);
    } catch (error) {
      await attachJsonFailureEvidence('scan-terminal-state', async () => ({
        elapsedSinceReleaseMs: Date.now() - releasedAt,
        releaseMarkerExists: fs.existsSync(releasePath),
        queueMetricsWritten: fs.existsSync(queueMetricsPath),
        heartbeatWritten: fs.existsSync(heartbeatPath),
        renderer: await window.evaluate(async () => {
          const view = window as unknown as Window & {
            __scanFinished?: boolean;
            __scanError?: string;
            __scanResult?: unknown;
            __scanProgress?: Array<{ at: number; total: number | null; indexed: number; discovered: number }>;
          };
          return {
            finished: view.__scanFinished,
            error: view.__scanError,
            result: view.__scanResult,
            latestProgress: view.__scanProgress?.slice(-8) ?? [],
            jobs: await window.polytray.getBackgroundJobs(),
          };
        }),
      }));
      throw error;
    }
    const result = await window.evaluate(() => (window as unknown as {
      __scanResult: { totalFiles: number };
      __scanError?: string;
    }).__scanResult);
    expect(result).toBeTruthy();
    expect(result.totalFiles).toBe(5_000);
    await expect.poll(() => fs.existsSync(queueMetricsPath)).toBe(true);
    const queueMetrics = JSON.parse(fs.readFileSync(queueMetricsPath, 'utf8')) as {
      samples: number; maxDiscoveryQueueDepth: number; maxMetadataQueueDepth: number;
    };
    expect(queueMetrics.samples).toBeGreaterThan(0);
    expect(queueMetrics.maxDiscoveryQueueDepth).toBeLessThanOrEqual(50);
    expect(queueMetrics.maxMetadataQueueDepth).toBeLessThanOrEqual(100);
    const progress = await window.evaluate(() => (window as unknown as {
      __scanProgress: Array<{ at: number; total: number | null; indexed: number; discovered: number }>;
    }).__scanProgress);
    const regularProgress = progress.filter((event, index) => index > 0 && event.total === null);
    let maxRegularPerSecond = 0;
    for (let start = 0, end = 0; start < regularProgress.length; start++) {
      while (end < regularProgress.length && regularProgress[end].at - regularProgress[start].at < 1_000) end++;
      maxRegularPerSecond = Math.max(maxRegularPerSecond, end - start);
    }
    const totalKnownBoundaries = progress.filter((event) => event.total !== null).length;
    expect(progressBeforeRelease.some((event) => event.indexed > 0 && event.total === null)).toBe(true);
    expect(maxRegularPerSecond).toBeLessThanOrEqual(4);
    await expect.poll(() => fs.existsSync(heartbeatPath)).toBe(true);
    const heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8')) as {
      intervalMs: number; samples: number; maxGapMs: number | null; gapsMs: number[];
      slowPhases: Array<{ phase: string; elapsedMs: number; durationMs: number; discovered: number; indexed: number }>;
    };
    expect(heartbeat.intervalMs).toBe(25);
    expect(heartbeat.samples).toBeGreaterThan(0);
    expect(heartbeat.maxGapMs).not.toBeNull();
    if (heartbeat.maxGapMs! > SCAN_HEARTBEAT_BUDGET_MS) {
      let elapsedMs = 0;
      await attachJsonFailureEvidence('scan-heartbeat-gap', async () => ({
        maxGapMs: heartbeat.maxGapMs,
        budgetMs: SCAN_HEARTBEAT_BUDGET_MS,
        topGaps: heartbeat.gapsMs.map((gapMs, index) => ({ index, gapMs, elapsedMs: elapsedMs += gapMs }))
          .sort((a, b) => b.gapMs - a.gapMs).slice(0, 10),
        slowPhases: heartbeat.slowPhases,
      }));
    }
    expect(heartbeat.maxGapMs!).toBeLessThanOrEqual(SCAN_HEARTBEAT_BUDGET_MS);
    console.info('[S02 scan metrics]', JSON.stringify({
      firstQueryableBatchMs: proof.elapsedMs,
      indexedAtFirstQuery: proof.indexed,
      firstFileCardVisibleBeforeRelease: true,
      firstVisibleCardMs,
      progressEventCount: progress.length,
      progressBoundaryEvents: { firstBatch: 1, totalKnown: totalKnownBoundaries },
      maximumRegularEventsInRollingSecond: maxRegularPerSecond,
      queueHighWater: queueMetrics,
      mainHeartbeatMaxGapMs: heartbeat.maxGapMs,
      mainHeartbeatBudgetMs: SCAN_HEARTBEAT_BUDGET_MS,
      mainHeartbeatSamples: heartbeat.samples,
    }));
  } finally {
    if (isolated) {
      if (releasePath && !fs.existsSync(releasePath)) fs.writeFileSync(releasePath, 'release');
      await isolated.close();
    }
  }
});
