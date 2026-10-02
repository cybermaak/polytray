import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildElectronLaunchArgs, buildElectronLaunchEnv } from '../../support/helpers/electronLaunch';
import { findMainWindow } from '../../support/helpers/isolatedApp';

const appRoot = path.resolve(__dirname, '../../..');
const settings = {
  thumbnail_timeout: 20000,
  scanning_batch_size: 50,
  watcher_stability: 1000,
  page_size: 500,
  thumbnailColor: '#8888aa',
  thumbQuality: '128' as const,
};
let app: Awaited<ReturnType<typeof electron.launch>>;
let page: import('@playwright/test').Page;
let scratch: string;
let modelPath: string;

function writeModel(filename: string, suffix = '') {
  fs.writeFileSync(filename, `solid cube\nfacet normal 0 0 1\n outer loop\n vertex 0 0 0\n vertex 1 0 0\n vertex 0 1 0\n endloop\nendfacet\nendsolid cube\n${suffix}`);
}

test.beforeAll(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-thumbnail-lifecycle-'));
  const userData = path.join(scratch, 'userData');
  const library = path.join(scratch, 'library');
  fs.mkdirSync(library);
  modelPath = path.join(library, 'model.stl');
  writeModel(modelPath);
  const extraArgs = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [];
  const args = buildElectronLaunchArgs(path.join(appRoot, 'out/main/index.js'), userData, extraArgs);
  app = await electron.launch({ args, env: buildElectronLaunchEnv(process.env, { ELECTRON_USER_DATA: userData }) });
  page = await findMainWindow(app);
  await page.evaluate(({ libraryPath, runtimeSettings }) => window.polytray.scanFolder(libraryPath, runtimeSettings), { libraryPath: library, runtimeSettings: settings });
});

test.afterAll(async () => {
  if (app) await app.close();
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

test('hidden renderer honors size, refreshes deleted cache output, and fences new revisions', async () => {
  const dimensions: Array<[number, number]> = [];
  const outputs: string[] = [];
  for (const size of ['128', '256', '512'] as const) {
    const result = await page.evaluate(async ({ path, settings, size }) => {
      const thumbPath = await window.polytray.requestThumbnailGeneration(path, 'stl', { ...settings, thumbQuality: size });
      return thumbPath;
    }, { path: modelPath, settings, size });
    expect(result).toBeTruthy();
    const bytes = fs.readFileSync(result!);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    dimensions.push([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]);
    outputs.push(result!);
  }
  expect(dimensions).toEqual([[128, 128], [256, 256], [512, 512]]);
  expect(new Set(outputs).size).toBe(3);

  const changedColor = await page.evaluate(({ path, settings }) => window.polytray.requestThumbnailGeneration(path, 'stl', { ...settings, thumbnailColor: '#cc8844' }), { path: modelPath, settings });
  expect(changedColor).toBeTruthy();
  expect(changedColor).not.toBe(outputs[0]);
  expect(fs.existsSync(changedColor!)).toBe(true);

  fs.rmSync(outputs[0]);
  const regenerated = await page.evaluate(async ({ path, settings }) => Promise.all([
    window.polytray.requestThumbnailGeneration(path, 'stl', settings),
    window.polytray.requestThumbnailGeneration(path, 'stl', settings),
  ]), { path: modelPath, settings });
  expect(regenerated[0]).toBe(regenerated[1]);
  expect(fs.existsSync(regenerated[0]!)).toBe(true);

  const corrupt = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('truncated PNG')]);
  fs.writeFileSync(regenerated[0]!, corrupt);
  const repaired = await page.evaluate(({ path, settings }) => window.polytray.requestThumbnailGeneration(path, 'stl', settings), { path: modelPath, settings });
  expect(repaired).toBe(regenerated[0]);
  const repairedBytes = fs.readFileSync(repaired!);
  expect(repairedBytes.length).toBeGreaterThan(corrupt.length);
  expect([repairedBytes.readUInt32BE(16), repairedBytes.readUInt32BE(20)]).toEqual([128, 128]);

  writeModel(modelPath, '# changed content revision\n');
  await page.evaluate(({ libraryPath, runtimeSettings }) => window.polytray.scanFolder(libraryPath, runtimeSettings), { libraryPath: path.dirname(modelPath), runtimeSettings: settings });
  const revisedPath = await page.evaluate(({ path, settings }) => window.polytray.requestThumbnailGeneration(path, 'stl', settings), { path: modelPath, settings });
  expect(revisedPath).toBeTruthy();
  expect(revisedPath).not.toBe(regenerated[0]);
  expect(fs.existsSync(revisedPath!)).toBe(true);
});
