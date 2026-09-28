import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildElectronLaunchArgs, buildElectronLaunchEnv } from '../../support/helpers/electronLaunch';

const appRoot = path.resolve(__dirname, '../../..');
const settings = {
  thumbnail_timeout: 20000,
  scanning_batch_size: 50,
  watcher_stability: 1000,
  page_size: 100,
  thumbnailColor: '#8888aa',
  thumbQuality: '128' as const,
};
let app: Awaited<ReturnType<typeof electron.launch>>;
let page: import('@playwright/test').Page;
let scratch = '';
let library = '';

function writeModel(filename: string, malformed = false) {
  const body = malformed ? 'this is not an STL model' :
    'solid cube\nfacet normal 0 0 1\n outer loop\n vertex 0 0 0\n vertex 1 0 0\n vertex 0 1 0\n endloop\nendfacet\nendsolid cube\n';
  fs.writeFileSync(filename, body);
}

test.beforeAll(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-thumbnail-controls-'));
  const userData = path.join(scratch, 'userData');
  library = path.join(scratch, 'library');
  fs.mkdirSync(library);
  for (let index = 0; index < 80; index += 1) writeModel(path.join(library, `model-${index.toString().padStart(3, '0')}.stl`));
  writeModel(path.join(library, 'bad-model.stl'), true);
  const extraArgs = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [];
  const args = buildElectronLaunchArgs(path.join(appRoot, 'out/main/index.js'), userData, extraArgs);
  app = await electron.launch({ args, env: buildElectronLaunchEnv(process.env, { ELECTRON_USER_DATA: userData }) });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#search-input').waitFor();
});

test.afterAll(async () => {
  if (app) await app.close();
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

test('thumbnail background job pause retains pending work and cancel is not recorded as failure', async () => {
  await page.evaluate(({ libraryPath, runtimeSettings }) => window.polytray.scanFolder(libraryPath, runtimeSettings), {
    libraryPath: library, runtimeSettings: settings,
  });
  const outcome = await page.evaluate(async () => {
    const bridge = window.polytray as unknown as {
      getBackgroundJobs: () => Promise<Array<{jobId: string; kind: string; state: string; counts: {thumbnailsPending: number; thumbnailsFailed: number}}>>;
      pauseJob: (jobId: string) => Promise<void>;
      resumeJob: (jobId: string) => Promise<void>;
      cancelJob: (jobId: string) => Promise<void>;
    };
    const deadline = Date.now() + 15000;
    let job = (await bridge.getBackgroundJobs()).find((candidate) => candidate.kind === 'thumbnail' && candidate.counts.thumbnailsPending > 0);
    while (!job && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      job = (await bridge.getBackgroundJobs()).find((candidate) => candidate.kind === 'thumbnail' && candidate.counts.thumbnailsPending > 0);
    }
    if (!job) throw new Error('thumbnail batch did not expose pending work');
    await bridge.pauseJob(job.jobId);
    const paused = (await bridge.getBackgroundJobs()).find((candidate) => candidate.jobId === job!.jobId)!;
    await bridge.resumeJob(job.jobId);
    await bridge.cancelJob(job.jobId);
    const cancelled = (await bridge.getBackgroundJobs()).find((candidate) => candidate.jobId === job!.jobId)!;
    return { paused: paused.state, pendingAtPause: paused.counts.thumbnailsPending, cancelled: cancelled.state, failedAtCancel: cancelled.counts.thumbnailsFailed };
  });
  expect(outcome.paused).toBe('paused');
  expect(outcome.pendingAtPause).toBeGreaterThan(0);
  expect(outcome.cancelled).toBe('cancelled');
  expect(outcome.failedAtCancel).toBe(0);
});
