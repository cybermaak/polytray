import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { buildElectronLaunchArgs, buildElectronLaunchEnv } from '../../support/helpers/electronLaunch';

const appRoot = path.resolve(__dirname, '../../..');
const runtimeSettings = { thumbnail_timeout: 20000, scanning_batch_size: 2, watcher_stability: 1000, page_size: 100, thumbnailColor: '#8888aa', thumbQuality: '128' as const };
let app: Awaited<ReturnType<typeof electron.launch>>;
let page: import('@playwright/test').Page;
let scratch = '';
let userData = '';
let library = '';
let launchLog = '';
let launchHoldPath = '';
let launchReachedPath = '';
let launchReleasePath = '';

async function launchWorkflowApp() {
  const args = buildElectronLaunchArgs(path.join(appRoot, 'out/main/index.js'), userData,
    process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []);
  return electron.launch({ args, env: buildElectronLaunchEnv(process.env, {
    ELECTRON_USER_DATA: userData,
    POLYTRAY_ISOLATED_TEST: '1',
    POLYTRAY_PERF_SCRATCH: scratch,
    POLYTRAY_SLICER_TEST_HOLD_LAUNCH: '1',
  }) });
}

function writeStl(filePath: string, name: string) {
  fs.writeFileSync(filePath, `solid ${name}\nfacet normal 0 0 1\n outer loop\n vertex 0 0 0\n vertex 10 0 0\n vertex 0 5 0\n endloop\nendfacet\nendsolid ${name}\n`);
}

test.beforeAll(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-product-workflows-'));
  userData = path.join(scratch, 'user-data');
  library = path.join(scratch, 'library');
  launchLog = path.join(scratch, 'mock-slicer-launches.jsonl');
  launchHoldPath = path.join(scratch, 'slicer-launch-hold');
  launchReachedPath = path.join(scratch, 'slicer-launch-reached');
  launchReleasePath = path.join(scratch, 'slicer-launch-release');
  fs.mkdirSync(userData); fs.mkdirSync(library);
  writeStl(path.join(library, 'regular.stl'), 'regular');
  writeStl(path.join(library, 'second.stl'), 'second');
  const zip = new JSZip();
  zip.file('nested/archive-model.stl', 'solid archive\nfacet normal 0 0 1\n outer loop\n vertex 0 0 0\n vertex 4 0 0\n vertex 0 4 0\n endloop\nendfacet\nendsolid archive\n');
  fs.writeFileSync(path.join(library, 'models.zip'), await zip.generateAsync({ type: 'nodebuffer' }));

  app = await launchWorkflowApp();
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#search-input').waitFor();
  await page.addInitScript((rootPath) => localStorage.setItem('polytray-library-state', JSON.stringify({ libraryFolders: [rootPath], lastFolder: rootPath })), library);
  await page.reload();
  await page.locator('#search-input').waitFor();
  await page.evaluate(({ rootPath, settings }) => window.polytray.scanFolder(rootPath, settings), { rootPath: library, settings: runtimeSettings });
  await expect(page.locator('.file-card')).toHaveCount(3, { timeout: 30000 });
});

test.afterAll(async () => {
  if (app) await app.close();
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

test('explicitly hands off an indexed model and only a chosen archive member', async () => {
  await page.locator('#btn-settings').click();
  await page.locator('#pick-slicer-application').click();
  await expect(page.locator('#slicer-settings-title')).toBeVisible();
  await page.locator('#settings-close').click();
  await expect(page.locator('#btn-settings')).toBeFocused();

  const regularCard = page.locator('.file-card').filter({ has: page.locator('.card-name[title="regular"]') });
  await regularCard.click();
  await expect(page.locator('#open-in-slicer')).toBeVisible();
  await page.locator('#open-in-slicer').click();
  await expect(page.getByRole('status').filter({ hasText: 'Model opened in the selected application' })).toBeVisible();
  await expect.poll(() => fs.existsSync(launchLog)).toBe(true);

  const archiveCard = page.locator('.file-card.archive-summary').filter({ has: page.locator('.card-name[title="models.zip"]') });
  await archiveCard.click();
  await expect(page.locator('#viewer-filename')).toContainText('models.zip');
  await expect(page.locator('#open-in-slicer')).toHaveCount(0);
  await expect(page.getByText('Choose an archive member before opening it in a slicer.')).toBeVisible();
  const member = page.locator('#archive-preview-models button[title="archive-model.stl"]');
  await expect(member).toBeVisible();
  await member.click();
  await expect(page.locator('#open-in-slicer')).toBeVisible();
  await page.locator('#open-in-slicer').click();
  await expect(page.getByRole('status').filter({ hasText: 'Model opened in the selected application' })).toBeVisible();

  const launches = fs.readFileSync(launchLog, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { configuration: { applicationPath: string }; modelPath: string });
  expect(launches).toHaveLength(2);
  expect(launches[0].modelPath).toBe(path.join(library, 'regular.stl'));
  expect(launches[1].modelPath).toContain(path.join(userData, 'slicer-handoff'));
  expect(launches[1].modelPath).toMatch(/\.stl$/i);
  expect(fs.existsSync(launches[1].modelPath)).toBe(true);
  expect(launches.every(launch => launch.configuration.applicationPath.startsWith(scratch))).toBe(true);
});

test('announces slicer preparation while the isolated mock launch is held', async () => {
  fs.writeFileSync(launchHoldPath, 'hold');
  try {
    const regularCard = page.locator('.file-card').filter({ has: page.locator('.card-name[title="regular"]') });
    await regularCard.click();
    const open = page.locator('#open-in-slicer');
    await expect(open).toBeVisible();
    await open.click();
    const preparing = page.getByRole('status').filter({ hasText: 'Preparing slicer handoff…' });
    await expect(preparing).toBeVisible();
    await expect(open).toBeDisabled();
    await expect.poll(() => fs.existsSync(launchReachedPath)).toBe(true);
    fs.writeFileSync(launchReleasePath, 'release');
    await expect(page.getByRole('status').filter({ hasText: 'Model opened in the selected application.' })).toBeVisible();
  } finally {
    fs.writeFileSync(launchReleasePath, 'release');
    fs.rmSync(launchHoldPath, { force: true });
    fs.rmSync(launchReleasePath, { force: true });
    fs.rmSync(launchReachedPath, { force: true });
  }
});

test('shows honest measurement labels and compare uses the same file-size terminology', async () => {
  const regular = page.locator('.file-card').filter({ has: page.locator('.card-name[title="regular"]') });
  await regular.click();
  await expect(page.locator('#viewer-meta')).toContainText('File size:');
  await expect(page.locator('#viewer-meta')).not.toContainText('Volume:');
  await page.locator('#btn-close-viewer').click();
  const cards = page.locator('.file-card:not(.archive-summary)');
  await cards.nth(0).locator('.file-select-toggle').click();
  await cards.nth(1).locator('.file-select-toggle').click();
  await page.locator('#compare-selected').click();
  await expect(page.locator('#compare-panel')).toContainText('File size');
  await expect(page.locator('#compare-panel')).not.toContainText('Volume');
  await expect(page.locator('#compare-panel')).toContainText('Dimensions');
});

test('previews, cancels, and applies portable metadata restore with conflicts and unmatched pending paths', async () => {
  const regular = await page.evaluate(async () => (await window.polytray.getFiles({ limit: 100, offset: 0 })).files.find(file => file.name === 'regular'));
  expect(regular).toBeTruthy();
  await page.evaluate(async file => window.polytray.updateFileMetadata({ id: file.id, tags: ['existing'], notes: 'keep my note' }), regular!);

  await page.locator('#btn-settings').click();
  await page.locator('#export-metadata-backup').click();
  await expect.poll(() => fs.existsSync(path.join(scratch, 'metadata-backup.json'))).toBe(true);
  const exported = JSON.parse(fs.readFileSync(path.join(scratch, 'metadata-backup.json'), 'utf8')) as {
    annotations: Array<{ path: string; tags: string[]; notes: string | null }>;
    pendingAnnotations: Array<{ path: string; tags: string[]; notes: string | null }>;
    libraryRoots: string[];
    preferences: Record<string, unknown>;
  };
  expect(fs.readFileSync(path.join(scratch, 'metadata-backup.json'), 'utf8')).not.toContain('facet normal');
  const indexed = exported.annotations.find(annotation => annotation.path === regular!.path)!;
  indexed.tags.push('from-backup');
  indexed.notes = 'different imported note';
  const laterModelPath = path.join(library, 'later-model.stl');
  exported.pendingAnnotations.push({ path: laterModelPath, tags: ['later'], notes: 'pending note' });
  exported.libraryRoots = [path.join(scratch, 'replacement-root')];
  exported.preferences.autoScan = false;
  const validBackup = path.join(scratch, 'conflict-backup.json');
  fs.writeFileSync(validBackup, JSON.stringify(exported));
  const malformed = path.join(scratch, 'malformed-backup.json');
  fs.writeFileSync(malformed, '{ malformed');

  await page.locator('#choose-metadata-backup').click();
  await page.locator('#metadata-backup-file').setInputFiles(malformed);
  await expect(page.getByRole('status').filter({ hasText: 'Expected property name' })).toBeVisible();
  expect((await page.evaluate(async id => window.polytray.getFileById(id), regular!.id))?.notes).toBe('keep my note');

  await page.locator('#choose-metadata-backup').click();
  await page.locator('#metadata-backup-file').setInputFiles(validBackup);
  await expect(page.getByRole('region', { name: 'Import preview' })).toBeVisible();
  await expect(page.locator('#metadata-backup-title').locator('..')).toContainText('Conflicts preserved');
  await expect(page.locator('#restore-replace-settings')).not.toBeChecked();
  await expect(page.locator('#restore-replace-roots')).not.toBeChecked();
  await page.locator('#cancel-metadata-import').click();
  expect((await page.evaluate(async id => window.polytray.getFileById(id), regular!.id))?.notes).toBe('keep my note');

  await page.locator('#choose-metadata-backup').click();
  await page.locator('#metadata-backup-file').setInputFiles(validBackup);
  await expect(page.locator('#apply-metadata-import')).toBeEnabled();
  await page.locator('#apply-metadata-import').click();
  await expect(page.locator('#settings-overlay')).toContainText('Metadata backup');
  await expect.poll(async () => (await page.evaluate(async id => window.polytray.getFileById(id), regular!.id))?.tags).toContain('from-backup');
  const current = await page.evaluate(async id => window.polytray.getFileById(id), regular!.id);
  expect(current?.notes).toBe('keep my note');
  expect(current?.tags).toContain('existing');
  await expect(page.locator('#metadata-backup-title').locator('..')).toContainText('1 annotations waiting for matching files');
  await expect(page.locator('#metadata-backup-title').locator('..')).toContainText('Recovery backup:');
  await expect(page.locator('#settings-overlay')).not.toContainText('Import committed. Waiting');
  await page.reload();
  await expect(page.locator('#search-input')).toBeVisible();
  const recovered = await page.evaluate(async id => window.polytray.getFileById(id), regular!.id);
  expect(recovered?.notes).toBe('keep my note');
  expect(recovered?.tags).toContain('from-backup');
  const localState = await page.evaluate(() => ({
    library: JSON.parse(localStorage.getItem('polytray-library-state') ?? '{}') as { libraryFolders: string[] },
    settings: JSON.parse(localStorage.getItem('polytray-settings') ?? '{}') as { autoScan: boolean },
  }));
  expect(localState.library.libraryFolders).toEqual([library]);
  expect(localState.settings.autoScan).toBe(true);

  await page.locator('#btn-settings').click();
  await page.locator('#retry-pending-annotations').click();
  await expect(page.locator('#metadata-backup-title').locator('..')).toContainText('Matched 0 pending annotations');
  writeStl(laterModelPath, 'later');
  await page.evaluate(({ rootPath, settings }) => window.polytray.scanFolder(rootPath, settings), { rootPath: library, settings: runtimeSettings });
  await expect.poll(async () => page.evaluate(async filePath => (await window.polytray.getFiles({ limit: 100, offset: 0 })).files.find(file => file.path === filePath)?.notes, laterModelPath)).toBe('pending note');
  const later = await page.evaluate(async filePath => (await window.polytray.getFiles({ limit: 100, offset: 0 })).files.find(file => file.path === filePath), laterModelPath);
  expect(later?.tags).toContain('later');
  expect(later?.notes).toBe('pending note');
  await expect(page.locator('#metadata-backup-title').locator('..')).toContainText('0 annotations waiting for matching files');
});

test('startup rolls a committed restore forward when the renderer has not applied it yet', async () => {
  const backup = JSON.parse(fs.readFileSync(path.join(scratch, 'conflict-backup.json'), 'utf8')) as { preferences: Record<string, unknown> };
  backup.preferences.autoScan = false;
  const transactionId = await page.evaluate(async backupData => {
    const libraryState = JSON.parse(localStorage.getItem('polytray-library-state') ?? '{}') as { libraryFolders: string[] };
    const collectionState = JSON.parse(localStorage.getItem('polytray-collections') ?? '{"collections":[]}') as { collections: Array<{ id: string; name: string; filePaths: string[] }> };
    const preferences = JSON.parse(localStorage.getItem('polytray-settings') ?? '{}') as Record<string, unknown>;
    const rendererRevision = Number(localStorage.getItem('polytray-renderer-state-revision') ?? 0);
    const currentSnapshot = await window.polytray.getMetadataRestoreSnapshot({
      rendererRevision,
      libraryRoots: libraryState.libraryFolders,
      collections: collectionState.collections.map(collection => ({ id: collection.id, name: collection.name, paths: collection.filePaths })),
      preferences,
    });
    const preview = await window.polytray.previewMetadataRestore({
      backup: backupData,
      currentSnapshot,
      options: { replaceSettings: true, replaceRoots: false },
    });
    if (preview.status !== 'preview') throw new Error(preview.message);
    const result = await window.polytray.commitMetadataRestore(preview.plan.transactionId);
    if (result.status !== 'staged') throw new Error(result.status === 'failed' ? result.message : 'Restore was cancelled');
    return preview.plan.transactionId;
  }, backup);
  expect(transactionId).toMatch(/^plan-/);

  await app.close();
  app = await launchWorkflowApp();
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#search-input')).toBeVisible({ timeout: 30000 });
  const recoveredState = await page.evaluate(() => ({
    library: JSON.parse(localStorage.getItem('polytray-library-state') ?? '{}') as { libraryFolders: string[] },
    settings: JSON.parse(localStorage.getItem('polytray-settings') ?? '{}') as { autoScan: boolean },
  }));
  expect(recoveredState.library.libraryFolders).toEqual([library]);
  expect(recoveredState.settings.autoScan).toBe(false);
  await expect.poll(async () => page.evaluate(async () => (await window.polytray.getMetadataRestoreStatus()).unresolved), { timeout: 30000 }).toBe(false);
  const status = await page.evaluate(() => window.polytray.getMetadataRestoreStatus());
  expect(status.error).toBeNull();
});
