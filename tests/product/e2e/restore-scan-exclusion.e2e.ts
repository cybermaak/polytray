import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { findMainWindow, launchIsolatedApp } from '../../support/helpers/isolatedApp';
import { buildMetadataBackupV1 } from '../../../src/shared/metadataBackup';

const runtime = { thumbnail_timeout: 20_000, scanning_batch_size: 1, watcher_stability: 1000, page_size: 50, thumbnailColor: '#8888aa' };

test('active and paused scans exclude restore; admission race unlocks and completed scan allows retry', async () => {
  test.setTimeout(90_000);
  let root = '', release = '', reached = '', backupPath = '';
  const env: NodeJS.ProcessEnv = {};
  const isolated = await launchIsolatedApp({
    mainEntry: path.resolve('out/main/index.js'), env,
    beforeLaunch: ({ scratchDir }) => {
      root = path.join(scratchDir, 'library');
      const held = path.join(root, 'z-held');
      fs.mkdirSync(path.join(root, 'a-first'), { recursive: true }); fs.mkdirSync(held);
      const fixture = path.resolve('tests/support/fixtures/test_model_a.stl');
      fs.copyFileSync(fixture, path.join(root, 'a-first', 'first.stl'));
      fs.copyFileSync(fixture, path.join(held, 'later.stl'));
      release = path.join(scratchDir, 'release'); reached = path.join(scratchDir, 'reached');
      Object.assign(env, { POLYTRAY_SCAN_TEST_HOLD_PATH: held, POLYTRAY_SCAN_TEST_RELEASE_PATH: release, POLYTRAY_SCAN_TEST_REACHED_PATH: reached });
      backupPath = path.join(scratchDir, 'backup.json');
      fs.writeFileSync(backupPath, JSON.stringify(buildMetadataBackupV1({
        exportedAt: '2026-10-02T00:00:00Z', appVersion: '1.1.1',
        indexedAnnotations: [], pendingAnnotations: [{ path: path.join(scratchDir, 'unmatched.stl'), tags: ['preserved'], notes: 'pending' }],
        snapshot: { rendererRevision: 0, libraryRoots: [], collections: [], preferences: {} },
      })));
    },
  });
  try {
    const page = await findMainWindow(isolated.app);
    await page.evaluate(folder => {
      localStorage.setItem('polytray-settings', JSON.stringify({ autoScan: false, watch: false }));
      localStorage.setItem('polytray-library-state', JSON.stringify({ libraryFolders: [folder], lastFolder: folder }));
    }, root);
    await page.reload(); await page.locator('#search-input').waitFor();
    await page.evaluate(({ folder, settings }) => {
      void window.polytray.scanFolder(folder, settings);
    }, { folder: root, settings: runtime });
    await expect.poll(() => fs.existsSync(reached)).toBe(true);
    const jobId = await page.evaluate(async () => (await window.polytray.getBackgroundJobs()).find(job => job.kind === 'scan' && job.state === 'running')!.jobId);
    const jobCard = page.locator(`.background-job[data-job-id="${jobId}"]`);
    const preview = async () => {
      await page.locator('#btn-settings').click();
      await page.locator('#choose-metadata-backup').click();
      await page.locator('#metadata-backup-file').setInputFiles(backupPath);
      await expect(page.getByRole('region', { name: 'Import preview' })).toBeVisible();
      return (await page.getByRole('region', { name: 'Import preview' }).getAttribute('data-transaction-id'))!;
    };
    const assertClean = async () => {
      await expect(page.locator('#close-settings-during-restore')).toHaveCount(0);
      const status = await page.evaluate(() => window.polytray.getMetadataRestoreStatus());
      expect(status.unresolved).toBe(false); expect(status.transactions).toHaveLength(0); expect(status.pendingAnnotationCount).toBe(0);
    };
    const runningPlan = await preview();
    await expect(page.locator('#apply-metadata-import')).toBeDisabled();
    await expect(page.getByText('Finish or cancel active scans before applying this import.')).toBeVisible();
    const runningRejected = await page.evaluate(id => window.polytray.commitMetadataRestore(id), runningPlan);
    expect(runningRejected.status).toBe('failed');
    if (runningRejected.status === 'failed') expect(runningRejected.message).toContain('Finish or cancel active scans');
    await assertClean();
    await page.locator('#settings-close').click();

    await page.locator('.background-work-details').evaluate(element => { (element as HTMLDetailsElement).open = true; });
    await jobCard.getByRole('button', { name: 'Pause', exact: true }).click();
    fs.writeFileSync(release, 'release discovery so pause can settle');
    await expect(jobCard).toHaveAttribute('data-job-state', 'paused');
    const pausedPlan = await preview();
    await expect(page.locator('#apply-metadata-import')).toBeDisabled();
    expect((await page.evaluate(id => window.polytray.commitMetadataRestore(id), pausedPlan)).status).toBe('failed');
    await assertClean();
    await page.locator('#settings-close').click();
    await expect(jobCard.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
    await jobCard.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(jobCard).toHaveAttribute('data-job-state', 'completed');

    await preview();
    await expect(page.locator('#apply-metadata-import')).toBeEnabled();
    // Send a direct scan IPC during the renderer-lock handshake. It must not queue,
    // and the main admission recheck must abort restore before any journal/SQLite write.
    await page.evaluate(({ folder, settings }) => {
      const view = window as typeof window & { __scanRace?: string; __stopScanRace?: () => void };
      view.__stopScanRace = window.polytray.onMetadataRestoreMutationLock(request => {
        if (!request.locked || !request.requireIdle) return;
        view.__stopScanRace?.();
        void window.polytray.scanFolder(folder, settings).then(
          () => { view.__scanRace = 'ran'; }, () => { view.__scanRace = 'rejected'; },
        );
      });
    }, { folder: root, settings: runtime });
    await page.locator('#apply-metadata-import').click();
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __scanRace?: string }).__scanRace)).toBe('rejected');
    await expect(page.getByText(/The import did not reach SQLite/).first()).toBeVisible();
    await assertClean();
    // Recoverable rejection removes the stale preview; choosing the backup again retries.
    await page.locator('#choose-metadata-backup').click();
    await page.locator('#metadata-backup-file').setInputFiles(backupPath);
    await expect(page.locator('#apply-metadata-import')).toBeEnabled();
    await page.locator('#apply-metadata-import').click();
    await expect.poll(() => page.evaluate(async () => (await window.polytray.getMetadataRestoreStatus()).pendingAnnotationCount)).toBe(1);
    // The pending count is written at the SQLite commit; the restore UI closes only after the
    // renderer apply and acknowledgment that follow, which can take several seconds on Windows.
    await expect.poll(() => page.evaluate(async () => (await window.polytray.getMetadataRestoreStatus()).unresolved), { timeout: 30000 }).toBe(false);
    await expect(page.locator('#close-settings-during-restore')).toHaveCount(0);
  } finally {
    if (!fs.existsSync(release)) fs.writeFileSync(release, 'release');
    await isolated.close();
  }
});
