import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchIsolatedApp, renameIsolatedFixtureRoot } from '../../support/helpers/isolatedApp';

const settings = {
  thumbnail_timeout: 20_000,
  scanning_batch_size: 10,
  watcher_stability: 80,
  page_size: 50,
  thumbnailColor: '#607090',
  thumbQuality: '128' as const,
};

type WatchNotice = { type: string; filePath: string };

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

async function readRows(page: import('@playwright/test').Page, folder: string) {
  return page.evaluate((folderPath) => window.polytray.getFiles({ folder: folderPath, limit: 100, offset: 0 }), folder);
}

async function readRow(page: import('@playwright/test').Page, folder: string, filePath: string) {
  const result = await readRows(page, folder);
  return result.files.find((file) => file.path === filePath) ?? null;
}

function copyModel(source: string, target: string) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

/** Overwrite with a valid binary STL one triangle larger, so size and bytes change as well as mtime. */
function writeGrownModel(source: string, target: string) {
  const original = fs.readFileSync(source);
  const triangleCount = original.readUInt32LE(80);
  const lastTriangle = original.subarray(84 + (triangleCount - 1) * 50, 84 + triangleCount * 50);
  const grown = Buffer.concat([original.subarray(0, 84 + triangleCount * 50), lastTriangle]);
  grown.writeUInt32LE(triangleCount + 1, 80);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, grown);
}

test('utility watcher indexes before enrichment, fences scan churn, and recovers an unavailable root', async () => {
  const env: NodeJS.ProcessEnv = {};
  let root = '';
  let beforeScan = '';
  let seedPath = '';
  let releasePath = '';
  let reachedPath = '';
  let rootStatusReleasePath = '';
  let rootStatusReachedPath = '';
  let outsidePath = '';
  let offlineRoot = '';
  let isolated: Awaited<ReturnType<typeof launchIsolatedApp>> | null = null;
  let mainPage: import('@playwright/test').Page | null = null;

  try {
    isolated = await launchIsolatedApp({
      mainEntry: path.join(process.cwd(), 'out/main/index.js'),
      env,
      beforeLaunch: ({ scratchDir }) => {
        root = path.join(scratchDir, 'library');
        beforeScan = path.join(root, 'a-before');
        seedPath = path.join(beforeScan, 'seed.stl');
        releasePath = path.join(scratchDir, 'release-scan');
        reachedPath = path.join(scratchDir, 'scan-held');
        rootStatusReleasePath = path.join(scratchDir, 'release-watcher-root-check');
        rootStatusReachedPath = path.join(scratchDir, 'watcher-root-check-held');
        outsidePath = path.join(scratchDir, 'outside.stl');
        offlineRoot = `${root}-offline`;
        fs.mkdirSync(beforeScan, { recursive: true });
        copyModel(path.join(process.cwd(), 'tests/support/fixtures/test_model_a.stl'), seedPath);
        copyModel(path.join(process.cwd(), 'tests/support/fixtures/test_model_b.stl'), outsidePath);
        fs.writeFileSync(rootStatusReleasePath, 'release');
        env.POLYTRAY_SCAN_TEST_HOLD_PATH = root;
        env.POLYTRAY_SCAN_TEST_RELEASE_PATH = releasePath;
        env.POLYTRAY_SCAN_TEST_REACHED_PATH = reachedPath;
        env.POLYTRAY_WATCHER_TEST_ROOT_PATH = root;
        env.POLYTRAY_WATCHER_TEST_ROOT_RELEASE_PATH = rootStatusReleasePath;
        env.POLYTRAY_WATCHER_TEST_ROOT_REACHED_PATH = rootStatusReachedPath;
      },
    });
    mainPage = await findMainWindow(isolated.app);
    const page = mainPage;

    await page.evaluate(() => {
      const state = window as Window & {
        __watchNotices?: WatchNotice[];
        __folderActions?: Array<{ action: string; path: string }>;
        __scanResult?: unknown;
        __scanCompleteCount?: number;
      };
      state.__watchNotices = [];
      state.__folderActions = [];
      state.__scanCompleteCount = 0;
      window.polytray.onFilesUpdated((notice) => state.__watchNotices?.push(notice));
      window.polytray.onFolderAction((action, folderPath) => state.__folderActions?.push({ action, path: folderPath }));
      window.polytray.onScanComplete(() => { state.__scanCompleteCount = (state.__scanCompleteCount ?? 0) + 1; });
    });

    await page.evaluate(({ folder, runtime }) => window.polytray.startWatching([folder], runtime), { folder: root, runtime: settings });
    await expect.poll(() => page.evaluate((rootPath) =>
      (window as Window & { __watchNotices?: WatchNotice[] }).__watchNotices?.some(
        (notice) => notice.type === 'root-available' && notice.filePath === rootPath,
      ) ?? false, root), { timeout: 15_000 }).toBe(true);
    await page.evaluate(({ folder, runtime }) => {
      const state = window as Window & { __scanResult?: unknown; __scanError?: string };
      void window.polytray.scanFolder(folder, runtime).then(
        (result) => { state.__scanResult = result; },
        (error) => { state.__scanError = String(error); },
      );
    }, { folder: root, runtime: settings });
    await expect.poll(() => fs.existsSync(reachedPath), { timeout: 20_000 }).toBe(true);

    const watchedPath = path.join(beforeScan, 'watched-add.stl');
    copyModel(path.join(process.cwd(), 'tests/support/fixtures/test_model_a.stl'), watchedPath);
    await expect.poll(async () => (await readRow(page, beforeScan, watchedPath))?.content_revision ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await readRow(page, beforeScan, watchedPath))?.thumbnail ?? null, { timeout: 20_000 }).toBeTruthy();
    const firstRevision = await readRow(page, beforeScan, watchedPath);
    expect(firstRevision).toBeTruthy();
    expect(fs.existsSync(firstRevision!.thumbnail!)).toBe(true);
    expect(await page.evaluate(async (filePath) => {
      try { return (await fetch(`polytray://local/${encodeURIComponent(filePath)}`)).status; }
      catch { return 0; }
    }, watchedPath)).toBe(200);
    expect(await page.evaluate(async (filePath) => {
      try { return (await fetch(`polytray://local/${encodeURIComponent(filePath)}`)).status; }
      catch { return 0; }
    }, outsidePath)).toBe(403);

    // test_model_a/b are byte-identical; an identical overwrite only changes mtime, which coarse
    // Windows timestamps and event coalescing can miss.
    writeGrownModel(path.join(process.cwd(), 'tests/support/fixtures/test_model_a.stl'), watchedPath);
    await expect.poll(async () => (await readRow(page, beforeScan, watchedPath))?.content_revision ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(firstRevision!.content_revision);
    await expect.poll(async () => {
      const row = await readRow(page, beforeScan, watchedPath);
      return row?.thumbnail && row.thumbnail !== firstRevision!.thumbnail ? row.thumbnail : null;
    }, { timeout: 20_000 }).toBeTruthy();

    fs.unlinkSync(watchedPath);
    await expect.poll(async () => (await readRow(page, beforeScan, watchedPath)) === null, { timeout: 15_000 }).toBe(true);

    const survivorPath = path.join(beforeScan, 'watched-survivor.stl');
    copyModel(path.join(process.cwd(), 'tests/support/fixtures/test_model_a.stl'), survivorPath);
    await expect.poll(async () => (await readRow(page, beforeScan, survivorPath))?.thumbnail ?? null, { timeout: 20_000 }).toBeTruthy();

    fs.writeFileSync(releasePath, 'release');
    await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __scanResult?: unknown }).__scanResult)),
      { timeout: 20_000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as Window & { __scanCompleteCount?: number }).__scanCompleteCount ?? 0),
      { timeout: 15_000 }).toBeGreaterThan(0);
    expect(await readRow(page, beforeScan, watchedPath)).toBeNull();
    const survivor = await readRow(page, beforeScan, survivorPath);
    expect(survivor?.thumbnail).toBeTruthy();

    await page.evaluate(({ id }) => window.polytray.updateFileMetadata({
      id, tags: ['offline-preserved'], notes: 'kept through root reconnect',
    }), { id: survivor!.id });
    const scanCountBeforeReconnect = await page.evaluate(() => (window as Window & { __scanCompleteCount?: number }).__scanCompleteCount ?? 0);
    const noticeCountBeforeReconnect = await page.evaluate(() => (window as Window & { __watchNotices?: WatchNotice[] }).__watchNotices?.length ?? 0);
    // The app may stop watching after the standalone scan because this fixture does not configure renderer-owned roots.
    await page.evaluate(({ folder, runtime }) => window.polytray.startWatching([folder], runtime), { folder: root, runtime: settings });
    await expect.poll(() => page.evaluate(({ folder, after }) =>
      (window as Window & { __watchNotices?: WatchNotice[] }).__watchNotices?.slice(after).some(
        (notice) => notice.type === 'root-available' && notice.filePath === folder,
      ) ?? false, { folder: root, after: noticeCountBeforeReconnect }), { timeout: 15_000 }).toBe(true);
    // Windows can lock a watched directory against rename. Restart on the missing path
    // to exercise root-unavailable and reconnect handling without renaming a live watcher root.
    if (process.platform === 'win32') await page.evaluate(() => window.polytray.stopWatching());
    await renameIsolatedFixtureRoot(root, offlineRoot);
    if (process.platform === 'win32') {
      await page.evaluate(({ folder, runtime }) => window.polytray.startWatching([folder], runtime),
        { folder: root, runtime: settings });
    }
    await expect.poll(() => page.evaluate(() =>
      (window as Window & { __watchNotices?: WatchNotice[] }).__watchNotices?.some((notice) => notice.type === 'root-unavailable') ?? false),
    { timeout: 15_000 }).toBe(true);
    const retained = await readRow(page, beforeScan, survivorPath);
    expect(retained?.tags).toContain('offline-preserved');
    expect(retained?.notes).toBe('kept through root reconnect');
    expect(await readRow(page, beforeScan, seedPath)).toBeTruthy();
    fs.unlinkSync(path.join(offlineRoot, 'a-before', 'seed.stl'));
    expect(await readRow(page, beforeScan, seedPath)).toBeTruthy();

    const noticeCountBeforeOfflineRestart = await page.evaluate(() => (window as Window & { __watchNotices?: WatchNotice[] }).__watchNotices?.length ?? 0);
    fs.rmSync(releasePath, { force: true });
    fs.rmSync(reachedPath, { force: true });
    fs.rmSync(rootStatusReleasePath, { force: true });
    fs.rmSync(rootStatusReachedPath, { force: true });
    await page.evaluate(() => window.polytray.stopWatching());
    await page.evaluate(({ folder, runtime }) => window.polytray.startWatching([folder], runtime), { folder: root, runtime: settings });
    await expect.poll(() => fs.existsSync(rootStatusReachedPath), { timeout: 15_000 }).toBe(true);
    fs.rmSync(rootStatusReachedPath, { force: true });
    await renameIsolatedFixtureRoot(offlineRoot, root);
    fs.writeFileSync(rootStatusReleasePath, 'release');
    await expect.poll(() => page.evaluate(({ folder, after }) =>
      (window as Window & { __watchNotices?: WatchNotice[] }).__watchNotices?.slice(after).some(
        (notice) => notice.type === 'root-available' && notice.filePath === folder,
      ) ?? false, { folder: root, after: noticeCountBeforeOfflineRestart }), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => page.evaluate((rootPath) =>
      (window as Window & { __folderActions?: Array<{ action: string; path: string }> }).__folderActions?.some(
        (entry) => entry.action === 'rescan' && entry.path === rootPath,
      ) ?? false, root), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => fs.existsSync(reachedPath), { timeout: 15_000 }).toBe(true);
    expect(await readRow(page, beforeScan, seedPath)).toBeTruthy();
    fs.writeFileSync(releasePath, 'release');
    await expect.poll(() => page.evaluate((before) =>
      ((window as Window & { __scanCompleteCount?: number }).__scanCompleteCount ?? 0) > before,
    scanCountBeforeReconnect), { timeout: 20_000 }).toBe(true);
    const afterReconnect = await readRow(page, beforeScan, survivorPath);
    expect(afterReconnect?.tags).toContain('offline-preserved');
    expect(afterReconnect?.notes).toBe('kept through root reconnect');
    await expect.poll(async () => (await readRow(page, beforeScan, seedPath)) === null, { timeout: 10_000 }).toBe(true);

    // Reconfiguring twice must still leave one worker/listener set for subsequent file events.
    const noticeCountBeforeReconfigure = await page.evaluate(() => (window as Window & { __watchNotices?: WatchNotice[] }).__watchNotices?.length ?? 0);
    await page.evaluate(({ folder, runtime }) => window.polytray.startWatching([folder], runtime), { folder: root, runtime: settings });
    await expect.poll(() => page.evaluate(({ folder, after }) =>
      (window as Window & { __watchNotices?: WatchNotice[] }).__watchNotices?.slice(after).some(
        (notice) => notice.type === 'root-available' && notice.filePath === folder,
      ) ?? false, { folder: root, after: noticeCountBeforeReconfigure }), { timeout: 15_000 }).toBe(true);
    const noticeCountBeforeSecondConfigure = await page.evaluate(() => (window as Window & { __watchNotices?: WatchNotice[] }).__watchNotices?.length ?? 0);
    await page.evaluate(({ folder, runtime }) => window.polytray.startWatching([folder], runtime), { folder: root, runtime: settings });
    await expect.poll(() => page.evaluate(({ folder, after }) =>
      (window as Window & { __watchNotices?: WatchNotice[] }).__watchNotices?.slice(after).some(
        (notice) => notice.type === 'root-available' && notice.filePath === folder,
      ) ?? false, { folder: root, after: noticeCountBeforeSecondConfigure }), { timeout: 15_000 }).toBe(true);
    const restartedPath = path.join(beforeScan, 'after-reconfigure.stl');
    copyModel(path.join(process.cwd(), 'tests/support/fixtures/test_model_a.stl'), restartedPath);
    await expect.poll(async () => (await readRow(page, beforeScan, restartedPath))?.thumbnail ?? null, { timeout: 20_000 }).toBeTruthy();
    await expect.poll(() => page.evaluate((filePath) =>
      (window as Window & { __watchNotices?: WatchNotice[] }).__watchNotices?.filter(
        (notice) => notice.filePath === filePath,
      ).length ?? 0, restartedPath), { timeout: 10_000 }).toBeGreaterThan(0);
    expect((await readRow(page, beforeScan, restartedPath))?.content_revision).toBeGreaterThan(0);

    await page.evaluate(() => window.polytray.stopWatching());
    const noticeCountBeforeRestart = await page.evaluate(() => (window as Window & { __watchNotices?: WatchNotice[] }).__watchNotices?.length ?? 0);
    await page.evaluate(({ folder, runtime }) => window.polytray.startWatching([folder], runtime), { folder: root, runtime: settings });
    await expect.poll(() => page.evaluate(({ folder, after }) =>
      (window as Window & { __watchNotices?: WatchNotice[] }).__watchNotices?.slice(after).some(
        (notice) => notice.type === 'root-available' && notice.filePath === folder,
      ) ?? false, { folder: root, after: noticeCountBeforeRestart }), { timeout: 15_000 }).toBe(true);
    const restartedAgainPath = path.join(beforeScan, 'after-stop-start.stl');
    copyModel(path.join(process.cwd(), 'tests/support/fixtures/test_model_a.stl'), restartedAgainPath);
    await expect.poll(async () => (await readRow(page, beforeScan, restartedAgainPath))?.thumbnail ?? null, { timeout: 20_000 }).toBeTruthy();
  } finally {
    try {
      if (isolated && rootStatusReleasePath && !fs.existsSync(rootStatusReleasePath)) fs.writeFileSync(rootStatusReleasePath, 'release');
      if (isolated && releasePath && !fs.existsSync(releasePath)) fs.writeFileSync(releasePath, 'release');
      if (mainPage) await mainPage.evaluate(() => window.polytray.stopWatching()).catch(() => undefined);
      if (isolated && rootStatusReachedPath) fs.rmSync(rootStatusReachedPath, { force: true });
      if (isolated && rootStatusReleasePath) fs.rmSync(rootStatusReleasePath, { force: true });
    } finally {
      await isolated?.close();
    }
  }
});
