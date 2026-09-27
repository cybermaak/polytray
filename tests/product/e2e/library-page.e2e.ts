const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const JSZip = require('jszip');
const { launchIsolatedApp } = require('../../support/helpers/isolatedApp');

const APP_DIR = path.resolve(__dirname, '../../..');
const SETTINGS = {
  thumbnail_timeout: 20000,
  scanning_batch_size: 10,
  watcher_stability: 1000,
  page_size: 50,
  thumbnailColor: '#8888aa',
};

function writeTinyStl(filePath, solidName) {
  fs.writeFileSync(filePath, `solid ${solidName}
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid ${solidName}
`);
}

async function findVisibleMainWindow(app) {
  await app.firstWindow();
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const page of app.windows()) {
      try {
        await page.locator('#search-input').waitFor({ timeout: 200 });
        return page;
      } catch {
        // Ignore the detached hidden thumbnail renderer.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Visible main window did not become ready');
}

test('GET_LIBRARY_PAGE IPC pages files and archive summaries after scope readiness', async () => {
  let libraryRoot = '';
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(APP_DIR, 'out/main/index.js'),
    beforeLaunch: async ({ scratchDir }) => {
      libraryRoot = path.join(scratchDir, 'library');
      fs.mkdirSync(libraryRoot);
      writeTinyStl(path.join(libraryRoot, 'alpha.stl'), 'alpha');
      writeTinyStl(path.join(libraryRoot, 'zulu.stl'), 'zulu');
      const archive = new JSZip();
      archive.file('parts/charlie.stl', fs.readFileSync(path.join(libraryRoot, 'alpha.stl')));
      archive.file('parts/delta.obj', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
      fs.writeFileSync(path.join(libraryRoot, 'bundle.zip'), await archive.generateAsync({ type: 'nodebuffer' }));
    },
  });

  try {
    const mainWindow = await findVisibleMainWindow(isolated.app);
    const scanResult = await mainWindow.evaluate(async ({ folder, settings }) =>
      window.polytray.scanFolder(folder, settings), { folder: libraryRoot, settings: SETTINGS });
    expect(scanResult.state).toBe('completed');

    const baseQuery = {
      sort: 'name', direction: 'ASC', extension: null, folder: null, search: '',
      collectionPaths: null, limit: 2, offset: 0,
    };
    const first = await mainWindow.evaluate((query) => window.polytray.getLibraryPage(query), baseQuery);
    expect(first.status).toBe('ok');
    expect(first.totalModels).toBe(4);
    expect(first.totalItems).toBe(3);
    expect(first.items).toHaveLength(2);
    expect(first.nextOffset).toBe(2);
    const archiveCard = first.items.find((item) => item.kind === 'archive');
    expect(archiveCard).toBeTruthy();
    expect(archiveCard.modelCount).toBe(2);
    expect(archiveCard.thumbnailSamples.length).toBeLessThanOrEqual(4);

    const second = await mainWindow.evaluate((query) => window.polytray.getLibraryPage(query), {
      ...baseQuery, offset: first.nextOffset,
    });
    expect(second.status).toBe('ok');
    expect(second.items).toHaveLength(1);
    expect(second.nextOffset).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.key)).size).toBe(3);

    const archiveEntries = await mainWindow.evaluate((query) => window.polytray.getLibraryPage(query), {
      ...baseQuery, archivePath: archiveCard.archivePath, limit: 1,
    });
    expect(archiveEntries.status).toBe('ok');
    expect(archiveEntries.totalItems).toBe(2);
    expect(archiveEntries.totalModels).toBe(2);
    expect(archiveEntries.items[0].kind).toBe('file');
    expect(archiveEntries.nextOffset).toBe(1);

    const archiveFolder = await mainWindow.evaluate((query) => window.polytray.getLibraryPage(query), {
      ...baseQuery, folder: `${archiveCard.archivePath}::entry::parts`, limit: 10,
    });
    expect(archiveFolder.totalItems).toBe(2);
    expect(archiveFolder.items.every((item) => item.kind === 'file')).toBe(true);

    const objectFilter = await mainWindow.evaluate((query) => window.polytray.getLibraryPage(query), {
      ...baseQuery, extension: 'obj', limit: 10,
    });
    expect(objectFilter.totalModels).toBe(1);
    expect(objectFilter.totalItems).toBe(1);
    expect(objectFilter.items[0].kind).toBe('archive');

    const emptyCollection = await mainWindow.evaluate((query) => window.polytray.getLibraryPage(query), {
      ...baseQuery, collectionPaths: [], limit: 10,
    });
    expect(emptyCollection.totalItems).toBe(0);
    expect(emptyCollection.items).toHaveLength(0);

    const folderFiles = await mainWindow.evaluate((folder) => window.polytray.getFiles({ folder, limit: 20, offset: 0 }), libraryRoot);
    expect(folderFiles.total).toBe(4);
    expect(folderFiles.files).toHaveLength(4);
    expect(folderFiles.files.every((file) => Number.isSafeInteger(file.content_revision))).toBe(true);
    expect(folderFiles.files.filter((file) => file.archive_path).length).toBe(2);

    const alpha = folderFiles.files.find((file) => file.name === 'alpha');
    await mainWindow.evaluate(({ id }) => window.polytray.updateFileMetadata({ id, tags: ['fresh'], notes: 'revision bump' }), { id: alpha.id });
    const stale = await mainWindow.evaluate((query) => window.polytray.getLibraryPage(query), {
      ...baseQuery, expectedBrowseRevision: first.revision,
    });
    expect(stale.status).toBe('stale');
    expect(stale.revision).toBeGreaterThan(first.revision);
  } finally {
    await isolated.close();
  }
});
