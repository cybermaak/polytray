import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { launchIsolatedApp } from '../../support/helpers/isolatedApp';
import { attachGridFailureEvidence } from '../../support/helpers/gridFailureEvidence';

const appDir = path.resolve(__dirname, '../../..');
const runtime = {
  thumbnail_timeout: 20_000, scanning_batch_size: 50, watcher_stability: 500,
  page_size: 500, thumbnailColor: '#7888aa', thumbQuality: '128' as const,
};

async function createIntegratedLibrary(scratchDir: string) {
  const libraryRoot = path.join(scratchDir, 'library');
  const archivePath = path.join(libraryRoot, 'large-mixed.zip');
  const regularRoot = path.join(libraryRoot, 'regular');
  fs.mkdirSync(regularRoot, { recursive: true });
  const stl = fs.readFileSync(path.join(appDir, 'tests/support/fixtures/test_model_a.stl'));
  const obj = Buffer.from('o integrated\nv 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n');
  const archive = new JSZip();
  for (let index = 0; index < 520; index += 1) {
    archive.file(`models/member-${String(index).padStart(5, '0')}.stl`, stl);
  }
  fs.writeFileSync(archivePath, await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  for (let index = 0; index < 80; index += 1) {
    fs.writeFileSync(path.join(regularRoot, `regular-${String(index).padStart(3, '0')}.${index % 2 ? 'obj' : 'stl'}`), index % 2 ? obj : stl);
  }
  return { libraryRoot, archivePath };
}

async function findMainWindow(app: Awaited<ReturnType<typeof launchIsolatedApp>>['app']) {
  await app.firstWindow();
  await expect.poll(async () => {
    for (const page of app.windows()) if (await page.locator('#search-input').isVisible().catch(() => false)) return true;
    return false;
  }, { timeout: 15_000 }).toBe(true);
  for (const page of app.windows()) if (await page.locator('#search-input').isVisible().catch(() => false)) return page;
  throw new Error('Visible main window did not become ready');
}

test('integrated 600-record library keeps paging and annotations through archive preview and backup restore', async () => {
  test.setTimeout(240_000);
  let fixture!: Awaited<ReturnType<typeof createIntegratedLibrary>>;
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(appDir, 'out/main/index.js'),
    beforeLaunch: async ({ scratchDir }) => { fixture = await createIntegratedLibrary(scratchDir); },
  });
  try {
    const page = await findMainWindow(isolated.app);
    await page.evaluate(({ root, collectionState }) => {
      const settings = JSON.parse(localStorage.getItem('polytray-settings') || '{}');
      localStorage.setItem('polytray-settings', JSON.stringify({ ...settings, autoScan: false, watch: false, page_size: 500 }));
      localStorage.setItem('polytray-library-state', JSON.stringify({ libraryFolders: [root], lastFolder: root }));
      localStorage.setItem('polytray-collections', JSON.stringify(collectionState));
    }, { root: fixture.libraryRoot, collectionState: { collections: [], activeCollectionId: null } });
    await page.reload();
    await page.locator('#search-input').waitFor();
    const scan = await page.evaluate(({ rootPath, settings }) => window.polytray.scanFolder(rootPath, settings),
      { rootPath: fixture.libraryRoot, settings: runtime });
    expect(scan.state).toBe('completed');
    await expect(page.locator('#library-result-total')).toContainText('600 models');

    const indexed = await page.evaluate(() => window.polytray.getFiles({ limit: 700, offset: 0 }));
    expect(indexed.files).toHaveLength(600);
    await page.evaluate(async files => {
      await Promise.all(files.map(file => window.polytray.updateFileMetadata({
        id: file.id, tags: ['integrated-seed'], notes: `annotation for ${file.name}`,
      })));
    }, indexed.files);
    const allPreImportIdentities = indexed.files.map(file => ({
      id: file.id, path: file.path, contentRevision: file.content_revision,
    }));
    const collectionPaths = indexed.files.map(file => file.path);
    const collection = { id: 'integrated-600', name: 'Integrated 600', filePaths: collectionPaths };
    await page.evaluate(collectionState => localStorage.setItem('polytray-collections', JSON.stringify(collectionState)),
      { collections: [collection], activeCollectionId: collection.id });
    await page.reload();
    await page.locator('#search-input').waitFor();
    await expect(page.locator('#library-result-total')).toContainText('600 models');

    const query = { sort: 'name', direction: 'ASC', extension: null, folder: null, search: '',
      collectionPaths, limit: 500, offset: 0 } as const;
    const before = await page.evaluate(value => window.polytray.getLibraryPage(value), query);
    expect(before.status).toBe('ok');
    expect(before.totalModels).toBe(600);
    expect(before.nextOffset).toBe(500);
    const tail = await page.evaluate(value => window.polytray.getLibraryPage(value), {
      ...query, offset: before.nextOffset!, expectedBrowseRevision: before.revision,
    });
    expect(tail.status).toBe('ok');
    expect(tail.items).toHaveLength(100);
    expect(collectionPaths).toContain(tail.items[0].file.path);
    const archiveQuery = { sort: 'name', direction: 'ASC', extension: null, folder: null, search: '',
      collectionPaths: null, archivePath: fixture.archivePath, limit: 500, offset: 0 } as const;
    const archivePage = await page.evaluate(value => window.polytray.getLibraryPage(value), archiveQuery);
    expect(archivePage.totalItems).toBe(520);
    expect(archivePage.totalModels).toBe(520);
    expect(archivePage.items.length).toBe(500);
    const sizeSorted = await page.evaluate(value => window.polytray.getLibraryPage(value), { ...query, sort: 'size', direction: 'DESC' });
    expect(sizeSorted.status).toBe('ok');
    expect(sizeSorted.items[0].file.size_bytes).toBeGreaterThanOrEqual(sizeSorted.items.at(-1)!.file.size_bytes);
    const searched = await page.evaluate(value => window.polytray.getLibraryPage(value), { ...query, search: 'regular-079' });
    expect(searched.totalModels).toBe(1);

    await page.locator('#sort-select').selectOption('size');
    await page.locator('#sort-order').click();
    await expect.poll(async () => Number(await page.locator('.file-card:not(.archive-summary)').first().getAttribute('data-file-id')))
      .toBe(sizeSorted.items[0].file.id);
    await page.locator('#search-input').fill('regular-079');
    await expect(page.locator('#library-result-total')).toContainText('1 model', { timeout: 15_000 });
    await expect(page.locator('.file-card:not(.archive-summary)')).toHaveCount(1);
    await page.locator('#search-clear').click();
    await expect(page.locator('#library-result-total')).toContainText('600 models', { timeout: 15_000 });
    await page.locator('#sort-select').selectOption('name');
    await page.locator('#sort-order').click();
    await expect.poll(async () => Number(await page.locator('.file-card:not(.archive-summary)').first().getAttribute('data-file-id')))
      .toBe(before.items[0].file.id);

    const tailCard = page.locator(`.file-card[data-file-id="${tail.items[0].file.id}"]`);
    try {
      const scroller = page.locator('[data-virtuoso-scroller]');
      await scroller.hover();
      const firstPageHeight = await scroller.evaluate((element) => element.scrollHeight);
      await page.mouse.wheel(0, firstPageHeight);
      const pageOneLastCard = page.locator(`[data-item-key="${before.items[499].key}"]`);
      const orderedKeys = [...before.items, ...tail.items].map((item) => item.key);
      let navigationState = 'waiting';
      await expect.poll(async () => {
        if (await tailCard.count()) return navigationState = 'target';
        if (await pageOneLastCard.count()) {
          return navigationState = await page.locator('.library-page-footer').count() ? 'edge' : 'loaded';
        }
        const firstMountedKey = await page.locator('#file-grid [data-item-key]').first().getAttribute('data-item-key');
        if (firstMountedKey && orderedKeys.indexOf(firstMountedKey) > 500) return navigationState = 'beyond';
        return navigationState;
      }, { timeout: 15_000 }).not.toBe('waiting');
      if (navigationState === 'edge') {
        await pageOneLastCard.focus();
        await page.keyboard.press('ArrowDown');
        await expect(tailCard).toBeVisible({ timeout: 15_000 });
      } else if (navigationState === 'loaded') {
        await page.mouse.wheel(0, 500);
      } else if (navigationState === 'beyond') {
        const delta = await page.evaluate((keys) => {
          const grid = document.querySelector<HTMLElement>('#file-grid');
          const first = grid?.querySelector<HTMLElement>('[data-item-key]');
          if (!grid || !first) return 0;
          const firstIndex = keys.indexOf(first.dataset.itemKey ?? '');
          const columns = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length;
          const rowGap = Number.parseFloat(getComputedStyle(grid).rowGap) || 0;
          return Math.ceil((firstIndex - 500) / columns) * (first.getBoundingClientRect().height + rowGap);
        }, orderedKeys);
        await page.mouse.wheel(0, -Math.max(500, delta));
      }
      await expect(tailCard).toBeVisible({ timeout: 30_000 });
    } catch (error) {
      await attachGridFailureEvidence(page, 'integrated-tail', `.file-card[data-file-id="${tail.items[0].file.id}"]`);
      throw error;
    }
    await expect(tailCard.locator('.card-name')).toBeVisible();
    await tailCard.locator('.file-select-toggle').click();
    await expect(page.locator('#batch-selection-count')).toHaveText('1 selected');
    await tailCard.locator('.file-select-toggle').click();

    const visibleCards = page.locator('.file-card:not(.archive-summary)');
    await page.locator('[data-virtuoso-scroller]').evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
    await expect.poll(async () => page.locator('.file-card:not(.archive-summary)').first().getAttribute('data-file-id'))
      .toBe(String(before.items[0].file.id));
    await visibleCards.nth(0).locator('.file-select-toggle').click();
    await visibleCards.nth(1).locator('.file-select-toggle').click();
    await page.locator('#compare-selected').click();
    await expect(page.locator('#compare-panel')).toBeVisible();
    await page.locator('#btn-close-compare').click();

    const firstCard = page.locator('.file-card:not(.archive-summary)').first();
    const firstId = Number(await firstCard.getAttribute('data-file-id'));
    await visibleCards.nth(0).locator('.file-select-toggle').click();
    await visibleCards.nth(1).locator('.file-select-toggle').click();
    await firstCard.locator('.file-select-toggle').click();
    await page.locator('#batch-tags-input').fill('integrated-tag');
    await page.locator('#apply-batch-tags').click();
    await expect.poll(async () => (await page.evaluate(id => window.polytray.getFileById(id), firstId))?.tags).toContain('integrated-tag');

    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('polytray-collections') || '{}');
      localStorage.setItem('polytray-collections', JSON.stringify({ ...state, activeCollectionId: null }));
    });
    await page.reload();
    await page.locator('#search-input').waitFor();
    const archiveCard = page.locator('.file-card.archive-summary').filter({ has: page.locator(`.card-name[title="${path.basename(fixture.archivePath)}"]`) });
    await archiveCard.click();
    await expect(page.locator('#archive-preview-models')).toBeVisible();
    const previewMember = page.locator('#archive-preview-models button[title="member-00000.stl"]');
    await previewMember.click();
    await expect(page.locator('#viewer-filename')).toBeVisible();
    await expect(page.locator('#viewer-meta')).toBeVisible();
    await page.locator('#btn-close-viewer').click();

    const afterMetadata = await page.evaluate(value => window.polytray.getLibraryPage(value), query);
    expect(afterMetadata.totalModels).toBe(before.totalModels);
    expect(afterMetadata.items.map(item => item.key)).toEqual(before.items.map(item => item.key));

    await page.locator('#btn-settings').click();
    await page.locator('#export-metadata-backup').click();
    const backupPath = path.join(isolated.scratchDir, 'metadata-backup.json');
    await expect.poll(() => fs.existsSync(backupPath)).toBe(true);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8')) as {
      annotations: Array<{ path: string; tags: string[]; notes: string | null }>;
      pendingAnnotations: Array<{ path: string; tags: string[]; notes: string | null }>;
    };
    expect(backup.annotations.length).toBeGreaterThan(500);
    const exportedAnnotationCount = backup.annotations.length;
    const conflicting = backup.annotations[0];
    const conflictBeforeApply = await page.evaluate(filePath => window.polytray.getFiles({ limit: 700, offset: 0 })
      .then(result => result.files.find(file => file.path === filePath) ?? null), conflicting.path);
    expect(conflictBeforeApply).toBeTruthy();
    conflicting.notes = 'imported conflicting note';
    backup.pendingAnnotations.push({ path: path.join(fixture.libraryRoot, 'not-yet-indexed.stl'), tags: ['pending'], notes: 'pending note' });
    const importPath = path.join(isolated.scratchDir, 'integrated-backup.json');
    fs.writeFileSync(importPath, JSON.stringify(backup));
    await page.locator('#choose-metadata-backup').click();
    await page.locator('#metadata-backup-file').setInputFiles(importPath);
    await expect(page.getByRole('region', { name: 'Import preview' })).toBeVisible();
    await expect(page.locator('#metadata-backup-title').locator('..')).toContainText('Conflicts preserved');
    await expect(page.locator('#metadata-backup-title').locator('..')).toContainText('Pending annotations1');
    await expect(page.locator('#metadata-backup-title').locator('..')).toContainText('Unmatched paths1');
    await page.locator('#apply-metadata-import').click();
    await expect(page.locator('#metadata-backup-title').locator('..')).toContainText('1 annotations waiting for matching files', { timeout: 30_000 });
    const afterImport = await page.evaluate(value => window.polytray.getLibraryPage(value), query);
    expect(afterImport.totalModels).toBe(before.totalModels);
    const allAfterImport = await page.evaluate(() => window.polytray.getFiles({ limit: 700, offset: 0 }));
    expect(allAfterImport.files).toHaveLength(600);
    expect(allAfterImport.files.map(file => ({ id: file.id, path: file.path, contentRevision: file.content_revision })))
      .toEqual(allPreImportIdentities);
    for (const file of allAfterImport.files) expect(JSON.parse(file.tags || '[]')).toContain('integrated-seed');
    expect(backup.annotations).toHaveLength(exportedAnnotationCount);
    const importedConflict = await page.evaluate(filePath => window.polytray.getFiles({ limit: 700, offset: 0 })
      .then(result => result.files.find(file => file.path === filePath) ?? null), conflicting.path);
    expect(importedConflict?.tags).toContain('integrated-seed');
    expect(importedConflict?.notes).toBe(conflictBeforeApply?.notes);
  } finally {
    await isolated.close();
  }
});
