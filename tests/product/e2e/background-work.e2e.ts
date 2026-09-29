import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { launchIsolatedApp } from '../../support/helpers/isolatedApp';
import { createThumbnailIdentity, thumbnailCacheFilename } from '../../../src/main/thumbnailIdentity';

const modelFixture = path.join(process.cwd(), 'tests/support/fixtures/test_model_a.stl');
const settings = { thumbnail_timeout: 20_000, scanning_batch_size: 1, watcher_stability: 80, page_size: 50, thumbnailColor: '#607090', thumbQuality: '128' as const };

test('background job controls retain browse state and watch follows only watch settings', async () => {
  const env: NodeJS.ProcessEnv = {};
  let root = '';
  let holdPath = '';
  let releasePath = '';
  let reachedPath = '';
  let watcherReleasePath = '';
  let watcherReachedPath = '';
  let isolated: Awaited<ReturnType<typeof launchIsolatedApp>> | null = null;
  try {
    isolated = await launchIsolatedApp({
      mainEntry: path.join(process.cwd(), 'out/main/index.js'),
      env,
      beforeLaunch: ({ scratchDir }) => {
        root = path.join(scratchDir, 'library');
        fs.mkdirSync(path.join(root, 'a-before'), { recursive: true });
        fs.copyFileSync(modelFixture, path.join(root, 'a-before', 'first-batch.stl'));
        for (let index = 0; index < 30; index += 1) fs.copyFileSync(modelFixture, path.join(root, 'a-before', `visible-${index}.stl`));
        holdPath = path.join(root, 'z-held');
        fs.mkdirSync(holdPath);
        for (let index = 0; index < 120; index += 1) fs.copyFileSync(modelFixture, path.join(holdPath, `held-${index}.stl`));
        releasePath = path.join(scratchDir, 'release-scan');
        reachedPath = path.join(scratchDir, 'scan-held');
        watcherReleasePath = path.join(scratchDir, 'release-watcher-root-check');
        watcherReachedPath = path.join(scratchDir, 'watcher-root-check-held');
        fs.writeFileSync(watcherReleasePath, 'allow watcher root check');
        env.POLYTRAY_SCAN_TEST_HOLD_PATH = holdPath;
        env.POLYTRAY_SCAN_TEST_RELEASE_PATH = releasePath;
        env.POLYTRAY_SCAN_TEST_REACHED_PATH = reachedPath;
        env.POLYTRAY_WATCHER_TEST_ROOT_PATH = root;
        env.POLYTRAY_WATCHER_TEST_ROOT_RELEASE_PATH = watcherReleasePath;
        env.POLYTRAY_WATCHER_TEST_ROOT_REACHED_PATH = watcherReachedPath;
      },
    });
    const app = isolated.app;
    await app.firstWindow();
    let page: import('@playwright/test').Page | undefined;
    await expect.poll(async () => {
      for (const candidate of app.windows()) {
        if (await candidate.locator('#search-input').isVisible().catch(() => false)) { page = candidate; return true; }
      }
      return false;
    }, { timeout: 15_000 }).toBe(true);
    if (!page) throw new Error(`Main window missing (open pages: ${app.windows().length})`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#empty-state')).toBeVisible({ timeout: 15_000 });
    await page.evaluate((folder) => {
      const current = JSON.parse(localStorage.getItem('polytray-settings') || '{}');
      localStorage.setItem('polytray-settings', JSON.stringify({ ...current, autoScan: false, watch: false }));
      localStorage.setItem('polytray-library-state', JSON.stringify({ libraryFolders: [folder], lastFolder: folder }));
    }, root);
    await page.reload();
    await page.locator('#search-input').waitFor();
    await expect(page.locator('#empty-state')).toBeVisible({ timeout: 15_000 });
    await page.evaluate((folder) => {
      const state = window as Window & { __rootAvailability?: string[]; __rootUnavailableCount?: number; __scanCompleteCount?: number };
      state.__rootAvailability = [];
      state.__rootUnavailableCount = 0;
      state.__scanCompleteCount = 0;
      window.polytray.onFilesUpdated((notice) => {
        if (notice.type === 'root-available' && notice.filePath === folder) {
          state.__rootAvailability?.push(notice.filePath);
        }
        if (notice.type === 'root-unavailable' && notice.filePath === folder) {
          state.__rootUnavailableCount = (state.__rootUnavailableCount ?? 0) + 1;
        }
      });
      window.polytray.onScanComplete(() => { state.__scanCompleteCount = (state.__scanCompleteCount ?? 0) + 1; });
    }, root);

    await page.evaluate(({ folder, runtime }) => {
      const state = window as Window & { __scanPromise?: Promise<unknown> };
      state.__scanPromise = window.polytray.scanFolder(folder, runtime);
    }, { folder: root, runtime: settings });
    await expect.poll(() => fs.existsSync(reachedPath), { timeout: 20_000 }).toBe(true);
    const jobId = await page.evaluate(async () => {
      const jobs = await window.polytray.getBackgroundJobs();
      return jobs.find((job) => job.kind === 'scan' && job.state === 'running')?.jobId ?? null;
    });
    expect(jobId).toBeTruthy();
    const jobCard = page.locator(`[data-job-id="${jobId}"]`);
    await expect(jobCard).toContainText('Discovery in progress');
    await expect(jobCard).not.toContainText('thumbnails generated');
    await expect(page.locator('.file-card[aria-label="first-batch.stl"]')).toBeVisible();
    const browseScroller = page.locator('[data-virtuoso-scroller]');
    await browseScroller.evaluate((element) => { element.scrollTop = 500; });
    await jobCard.getByRole('button', { name: 'Pause' }).click();
    fs.writeFileSync(releasePath, 'release bounded discovery unit for pause acknowledgement');
    await expect(jobCard).toHaveAttribute('data-job-state', 'paused');
    await jobCard.getByRole('button', { name: 'Cancel' }).click();
    await expect(jobCard).toHaveAttribute('data-job-state', 'cancelled');
    const retainedAnchor = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('[data-virtuoso-scroller]');
      if (!scroller) return null;
      const bounds = scroller.getBoundingClientRect();
      const card = [...document.querySelectorAll<HTMLElement>('.file-card')].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom;
      });
      return card?.dataset.itemKey ? {
        itemKey: card.dataset.itemKey,
        topOffset: Math.round(card.getBoundingClientRect().top - bounds.top),
      } : null;
    });

    // A rescan while watch is disabled must not start a watcher on completion.
    await page.evaluate(async (folder) => {
      await window.polytray.scanFolder(folder, { thumbnail_timeout: 20_000, scanning_batch_size: 1, watcher_stability: 80, page_size: 50, thumbnailColor: '#607090', thumbQuality: '128' });
    }, root);
    await expect.poll(() => page!.evaluate(async () => (await window.polytray.getBackgroundJobs()).some((job) => job.kind === 'scan' && ['completed', 'partial'].includes(job.state)))).toBe(true);
    await expect.poll(() => page!.evaluate(() => (window as Window & { __rootAvailability?: string[] }).__rootAvailability?.length ?? 0)).toBe(0);
    expect(retainedAnchor).toBeTruthy();
    await expect.poll(() => page!.evaluate((itemKey) => {
      const scroller = document.querySelector<HTMLElement>('[data-virtuoso-scroller]');
      if (!scroller || !itemKey) return null;
      const bounds = scroller.getBoundingClientRect();
      const card = [...scroller.querySelectorAll<HTMLElement>('.file-card')].find((candidate) => candidate.dataset.itemKey === itemKey);
      return card ? Math.round(card.getBoundingClientRect().top - bounds.top) : null;
    }, retainedAnchor?.itemKey)).toBe(retainedAnchor?.topOffset ?? null);
    const rescanTerminalId = await page.evaluate(async (folder) => (await window.polytray.getBackgroundJobs()).find((job) => job.rootPath === folder && job.state === 'completed')?.jobId, root);
    if (rescanTerminalId) await page.locator(`[data-job-id="${rescanTerminalId}"]`).getByRole('button', { name: 'Dismiss' }).click();

    // A resumed job accepts cancellation after the resume state has been published.
    fs.rmSync(releasePath, { force: true });
    fs.rmSync(reachedPath, { force: true });
    await page.evaluate((folder) => { void window.polytray.scanFolder(folder, { thumbnail_timeout: 20_000, scanning_batch_size: 1, watcher_stability: 80, page_size: 50, thumbnailColor: '#607090', thumbQuality: '128' }); }, root);
    await expect.poll(() => fs.existsSync(reachedPath), { timeout: 20_000 }).toBe(true);
    const resumeJobId = await page.evaluate(async (folder) => (await window.polytray.getBackgroundJobs()).find((job) => job.rootPath === folder && job.state === 'running')!.jobId, root);
    const resumeCard = page.locator(`[data-job-id="${resumeJobId}"]`);
    await resumeCard.getByRole('button', { name: 'Pause' }).click();
    fs.writeFileSync(releasePath, 'release current unit for pause acknowledgement');
    await expect(resumeCard).toHaveAttribute('data-job-state', 'paused');
    await resumeCard.getByRole('button', { name: 'Resume' }).click();
    await expect(resumeCard).toHaveAttribute('data-job-state', 'running');
    await expect(resumeCard).toHaveAttribute('data-job-state', 'completed');

    // Complete two adjacent jobs; dismissing one terminal card cannot hide its neighbor.
    const siblings = [path.join(isolated.scratchDir, 'sibling-a'), path.join(isolated.scratchDir, 'sibling-b')];
    for (const [index, sibling] of siblings.entries()) {
      fs.mkdirSync(sibling);
      fs.copyFileSync(modelFixture, path.join(sibling, `sibling-${index}.stl`));
    }
    await page.evaluate((roots) => roots.forEach((folder) => { void window.polytray.scanFolder(folder, {
      thumbnail_timeout: 20_000, scanning_batch_size: 1, watcher_stability: 80, page_size: 50, thumbnailColor: '#607090', thumbQuality: '128',
    }); }), siblings);
    await expect.poll(() => page!.evaluate(async (roots) => {
      const jobs = await window.polytray.getBackgroundJobs();
      return roots.every((rootPath) => jobs.some((job) => job.rootPath === rootPath && job.state === 'completed'));
    }, siblings)).toBe(true);
    const [siblingAId, siblingBId] = await page.evaluate(async (roots) => {
      const jobs = await window.polytray.getBackgroundJobs();
      return roots.map((rootPath) => jobs.find((job) => job.rootPath === rootPath)!.jobId);
    }, siblings);
    const siblingACard = page.locator(`[data-job-id="${siblingAId}"]`);
    const siblingBCard = page.locator(`[data-job-id="${siblingBId}"]`);
    await expect(siblingACard).toHaveAttribute('data-job-state', 'completed');
    await expect(siblingBCard).toHaveAttribute('data-job-state', 'completed');
    await page.locator('.background-work-details').evaluate((element) => { (element as HTMLDetailsElement).open = true; });
    await siblingACard.getByRole('button', { name: 'Dismiss' }).click();
    await expect(siblingACard).toHaveCount(0);
    await expect(siblingBCard).toHaveAttribute('data-job-state', 'completed');

    const retryRoot = path.join(isolated.scratchDir, 'retry-library');
    fs.mkdirSync(retryRoot);
    const badArchive = path.join(retryRoot, 'broken.zip');
    fs.writeFileSync(badArchive, 'not a zip');
    fs.copyFileSync(modelFixture, path.join(retryRoot, 'healthy.stl'));
    await page.evaluate((folder) => window.polytray.scanFolder(folder, {
      thumbnail_timeout: 20_000, scanning_batch_size: 1, watcher_stability: 80, page_size: 50, thumbnailColor: '#607090', thumbQuality: '128',
    }), retryRoot);
    await expect.poll(() => page!.evaluate(async (folder) => {
      const jobs = await window.polytray.getBackgroundJobs();
      return jobs.find((job) => job.rootPath === folder && job.state === 'partial')?.jobId ?? null;
    }, retryRoot)).not.toBeNull();
    await page.locator('.background-work-details').evaluate((element) => { (element as HTMLDetailsElement).open = true; });
    const retryJobId = await page.evaluate(async (folder) => (await window.polytray.getBackgroundJobs()).find((job) => job.rootPath === folder && job.state === 'partial')!.jobId, retryRoot);
    const retryCard = page.locator(`[data-job-id="${retryJobId}"]`);
    await expect(retryCard).toContainText('metadata failures');
    await expect(retryCard.getByRole('button', { name: 'Retry failed items' })).toBeEnabled();
    const archive = new JSZip();
    archive.file('nested/recovered.stl', 'solid recovered\nendsolid recovered\n');
    fs.writeFileSync(badArchive, await archive.generateAsync({ type: 'nodebuffer' }));
    await retryCard.getByRole('button', { name: 'Retry failed items' }).click();
    await expect(retryCard).toHaveAttribute('data-job-state', 'completed', { timeout: 20_000 });
    await browseScroller.evaluate((element) => { element.scrollTop = 0; });
    await expect(page.locator('.file-card[aria-label="healthy.stl"]')).toBeVisible();

    // Enable the real utility watcher, then prove irrelevant settings do not reconfigure it.
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.locator('label.toggle-switch:has(#setting-watch)').click();
    await expect(page.locator('#setting-watch')).toBeChecked();
    await expect.poll(() => fs.existsSync(watcherReachedPath)).toBe(true);
    await expect.poll(() => page!.evaluate(() => (window as Window & { __rootAvailability?: string[] }).__rootAvailability?.length ?? 0)).toBe(1);
    await page.locator('.advanced-toggle').click();
    await page.locator('#setting-page-size').fill('120');
    await page.locator('#setting-thumbnail-color').evaluate((element) => {
      const input = element as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '#336699');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#setting-thumb-quality').selectOption('512');
    await page.locator('#setting-thumbnail-timeout').fill('30000');
    await expect(page.locator('#setting-page-size')).toHaveValue('120');
    await expect(page.locator('#setting-thumb-quality')).toHaveValue('512');
    await expect(page.locator('#setting-thumbnail-timeout')).toHaveValue('30000');
    await expect.poll(() => page!.evaluate(() => JSON.parse(localStorage.getItem('polytray-settings') || '{}'))).toMatchObject({ thumbnailColor: '#336699', thumbQuality: '512', thumbnail_timeout: 30000 });
    await expect.poll(() => page!.evaluate(() => (window as Window & { __rootAvailability?: string[] }).__rootAvailability?.length ?? 0)).toBe(1);
    const watchedAdd = path.join(root, 'watcher-live.stl');
    fs.copyFileSync(modelFixture, watchedAdd);
    await expect.poll(() => page!.evaluate(async (filePath) => {
      const record = (await window.polytray.getFiles({ limit: 500, offset: 0 })).files.find((file) => file.path === filePath);
      return record?.thumbnail ?? null;
    }, watchedAdd), { timeout: 20_000 }).toBeTruthy();
    const watchedRecord = await page.evaluate(async (filePath) => (await window.polytray.getFiles({ limit: 500, offset: 0 })).files.find((file) => file.path === filePath) ?? null, watchedAdd);
    expect(watchedRecord).toBeTruthy();
    const expectedThumbnailName = thumbnailCacheFilename(createThumbnailIdentity(watchedAdd, watchedRecord!.content_revision, '#336699', 512).key);
    expect(path.basename(watchedRecord!.thumbnail!)).toBe(expectedThumbnailName);
    fs.rmSync(watcherReachedPath, { force: true });
    await page.locator('#setting-watcher-stability').fill('160');
    await expect.poll(() => fs.existsSync(watcherReachedPath)).toBe(true);
    await expect.poll(() => page!.evaluate(() => (window as Window & { __rootAvailability?: string[] }).__rootAvailability?.length ?? 0)).toBe(2);

    // Offline roots keep indexed rows actionable; reconnect starts a scoped scan that prunes only confirmed absence.
    await page.locator('#settings-close').click();
    const offlineModel = path.join(root, 'offline-target.stl');
    fs.copyFileSync(modelFixture, offlineModel);
    await expect.poll(() => page!.evaluate(async (filePath) => (await window.polytray.getFiles({ limit: 500, offset: 0 })).files.some((file) => file.path === filePath), offlineModel), { timeout: 15_000 }).toBe(true);
    await page.locator('#search-input').fill('offline-target');
    const offlineCard = page.locator('.file-card[aria-label^="offline-target.stl"]');
    await expect(offlineCard).toBeVisible();
    await offlineCard.locator('.file-select-toggle').click();
    await expect(page.locator('#batch-actions')).toBeVisible();
    const scanCompleteBeforeOffline = await page.evaluate(() => (window as Window & { __scanCompleteCount?: number }).__scanCompleteCount ?? 0);
    const unavailableBefore = await page.evaluate(() => (window as Window & { __rootUnavailableCount?: number }).__rootUnavailableCount ?? 0);
    const offlineRoot = `${root}-offline`;
    fs.renameSync(root, offlineRoot);
    await expect.poll(() => page!.evaluate((before) => ((window as Window & { __rootUnavailableCount?: number }).__rootUnavailableCount ?? 0) > before, unavailableBefore), { timeout: 15_000 }).toBe(true);
    await expect(offlineCard).toBeVisible();
    await expect(offlineCard.locator('.file-select-toggle')).toBeVisible();
    fs.rmSync(path.join(offlineRoot, 'offline-target.stl'));
    fs.rmSync(releasePath, { force: true });
    fs.rmSync(reachedPath, { force: true });
    fs.renameSync(offlineRoot, root);
    await expect.poll(() => page!.evaluate(() => (window as Window & { __rootAvailability?: string[] }).__rootAvailability?.length ?? 0)).toBe(3);
    await expect.poll(() => fs.existsSync(reachedPath), { timeout: 15_000 }).toBe(true);
    fs.writeFileSync(releasePath, 'release reconnect scan');
    await expect.poll(() => page!.evaluate((before) => ((window as Window & { __scanCompleteCount?: number }).__scanCompleteCount ?? 0) > before, scanCompleteBeforeOffline), { timeout: 20_000 }).toBe(true);
    await expect(offlineCard).toHaveCount(0);
    await expect.poll(() => page!.evaluate(async (filePath) => !(await window.polytray.getFiles({ limit: 500, offset: 0 })).files.some((file) => file.path === filePath), offlineModel)).toBe(true);
    await page.locator('#search-input').fill('');
    await expect(page.locator('.file-card[aria-label="first-batch.stl"]')).toBeVisible();

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.locator('label.toggle-switch:has(#setting-watch)').click();
    await expect(page.locator('#setting-watch')).not.toBeChecked();
  } finally {
    if (isolated) await isolated.close();
  }
});
