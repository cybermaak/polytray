import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { buildElectronLaunchArgs, buildElectronLaunchEnv } from '../../support/helpers/electronLaunch';

const appRoot = path.resolve(__dirname, '../../..');
const settings = {
  thumbnail_timeout: 20000, scanning_batch_size: 1, watcher_stability: 1000,
  page_size: 100, thumbnailColor: '#8888aa', thumbQuality: '128' as const,
};
let app: Awaited<ReturnType<typeof electron.launch>>;
let page: import('@playwright/test').Page;
let scratch = '';
let controlRoot = '';
let holdPath = '';
let releasePath = '';
let reachedPath = '';

function writeModel(filename: string, valid = true) {
  fs.writeFileSync(filename, valid
    ? 'solid cube\nfacet normal 0 0 1\n outer loop\n vertex 0 0 0\n vertex 1 0 0\n vertex 0 1 0\n endloop\nendfacet\nendsolid cube\n'
    : 'not a valid STL model');
}

test.beforeAll(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-controls-'));
  controlRoot = path.join(scratch, 'cancel-library');
  fs.mkdirSync(controlRoot);
  writeModel(path.join(controlRoot, 'seed.stl'));
  holdPath = path.join(controlRoot, 'a-held');
  releasePath = path.join(scratch, 'scan-release');
  reachedPath = path.join(scratch, 'scan-reached');
  const userData = path.join(scratch, 'userData');
  const args = buildElectronLaunchArgs(path.join(appRoot, 'out/main/index.js'), userData,
    process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []);
  app = await electron.launch({ args, env: buildElectronLaunchEnv(process.env, {
    ELECTRON_USER_DATA: userData,
    POLYTRAY_ISOLATED_TEST: '1',
    POLYTRAY_PERF_SCRATCH: scratch,
    POLYTRAY_SCAN_TEST_HOLD_PATH: holdPath,
    POLYTRAY_SCAN_TEST_RELEASE_PATH: releasePath,
    POLYTRAY_SCAN_TEST_REACHED_PATH: reachedPath,
  }) });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#search-input').waitFor();
});

test.afterAll(async () => {
  if (app) await app.close();
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

test('scan pause keeps browsing responsive and cancel never prunes committed rows', async () => {
  const seeded = await page.evaluate(async ({ rootPath, runtimeSettings }) => {
    await window.polytray.scanFolder(rootPath, runtimeSettings);
    const result = await window.polytray.getFiles({ limit: 100, offset: 0 });
    return result.files.find((file) => file.path === `${rootPath}/seed.stl`)?.id;
  }, { rootPath: controlRoot, runtimeSettings: settings });
  expect(seeded).toBeTruthy();
  fs.unlinkSync(path.join(controlRoot, 'seed.stl'));
  fs.mkdirSync(holdPath);
  for (let index = 0; index < 20; index += 1) writeModel(path.join(holdPath, `model-${index.toString().padStart(4, '0')}.stl`));

  await page.evaluate(({ rootPath, runtimeSettings }) => {
    (window as Window & { __scanPromise?: Promise<{ state: string; discovered: number }> }).__scanPromise = window.polytray.scanFolder(rootPath, runtimeSettings);
  }, { rootPath: controlRoot, runtimeSettings: settings });
  await expect.poll(() => fs.existsSync(reachedPath), { timeout: 20_000 }).toBe(true);
  const pauseJobId = await page.evaluate(async () => {
    const state = window as Window & { __pausePromise?: Promise<{ ok: boolean }> };
    const bridge = window.polytray as unknown as {
      getBackgroundJobs(): Promise<Array<{ jobId: string; kind: string; state: string }>>;
      pauseBackgroundJob(jobId: string): Promise<{ ok: boolean }>;
      cancelBackgroundJob(jobId: string): Promise<{ ok: boolean }>;
    };
    let job = (await bridge.getBackgroundJobs()).find((candidate) => candidate.kind === 'scan' && ['running', 'queued'].includes(candidate.state));
    while (!job) {
      await new Promise<void>((resolve) => {
        const stop = bridge.onBackgroundJobChanged((changed) => {
          if (changed.kind === 'scan' && ['running', 'queued'].includes(changed.state)) { stop(); resolve(); }
        });
      });
      job = (await bridge.getBackgroundJobs()).find((candidate) => candidate.kind === 'scan' && ['running', 'queued'].includes(candidate.state));
    }
    state.__pausePromise = bridge.pauseBackgroundJob(job.jobId);
    return job.jobId;
  });
  fs.writeFileSync(releasePath, 'continue current bounded discovery unit');
  const pausedResult = await page.evaluate(async ({ jobId }) => {
    const state = window as Window & { __pausePromise: Promise<{ ok: boolean }>; __scanPromise: Promise<{ state: string; discovered: number }> };
    const bridge = window.polytray as unknown as {
      getBackgroundJobs(): Promise<Array<{ jobId: string; state: string; counts: { discovered: number; indexed: number } }>>;
      cancelBackgroundJob(jobId: string): Promise<{ ok: boolean }>;
    };
    const command = await state.__pausePromise;
    const files = await window.polytray.getFiles({ limit: 5, offset: 0 });
    const snapshot = (await bridge.getBackgroundJobs()).find((candidate) => candidate.jobId === jobId)!;
    await bridge.cancelBackgroundJob(jobId);
    const result = await state.__scanPromise;
    return { command, state: snapshot.state, browsed: files.files.length >= 0, result: result.state,
      pausedDiscovered: snapshot.counts.discovered, finalDiscovered: result.discovered };
  }, { jobId: pauseJobId });
  expect(pausedResult.command.ok).toBe(true);
  expect(pausedResult.state).toBe('paused');
  expect(pausedResult.browsed).toBe(true);
  expect(pausedResult.result).toBe('cancelled');
  expect(pausedResult.finalDiscovered).toBe(pausedResult.pausedDiscovered);
  const retained = await page.evaluate(async (id) => window.polytray.getFileById(id), seeded!);
  expect(retained?.path).toBe(path.join(controlRoot, 'seed.stl'));
});

test('failed metadata retry leaves healthy files untouched', async () => {
  const root = path.join(scratch, 'retry-library');
  fs.mkdirSync(root);
  const failed = path.join(root, 'retry-me.zip');
  const healthy = path.join(root, 'healthy.stl');
  fs.writeFileSync(failed, 'broken archive');
  writeModel(healthy);
  const initial = await page.evaluate(async ({ rootPath, runtimeSettings }) =>
    window.polytray.scanFolder(rootPath, runtimeSettings), { rootPath: root, runtimeSettings: settings });
  expect(initial.state).toBe('partial');
  const archive = new JSZip();
  archive.file('nested/retry-me.stl', 'solid recovered\nendsolid recovered\n');
  fs.writeFileSync(failed, await archive.generateAsync({ type: 'nodebuffer' }));
  const retried = await page.evaluate(async (jobId) => {
    const bridge = window.polytray as unknown as {
      retryBackgroundJobFailures(jobId: string): Promise<{ ok: boolean; state?: string }>;
    };
    const result = await bridge.retryBackgroundJobFailures(jobId);
    const job = (await window.polytray.getBackgroundJobs()).find((candidate) => candidate.jobId === jobId);
    return { ...result, counts: job?.counts };
  }, initial.jobId);
  expect(retried.ok).toBe(true);
  expect(retried.state).toBe('completed');
  expect(retried.counts?.metadataCompleted).toBe(initial.metadataCompleted + 1);
  expect(retried.counts?.metadataFailed).toBe(0);
  const files = await page.evaluate(async () => (await window.polytray.getFiles({ limit: 100, offset: 0 })).files);
  expect(files.some((file) => file.path === healthy)).toBe(true);
  expect(files.some((file) => file.path === `${failed}::entry::nested/retry-me.stl`)).toBe(true);
});
