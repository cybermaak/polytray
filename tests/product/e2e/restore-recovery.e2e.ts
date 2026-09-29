const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { buildElectronLaunchArgs, buildElectronLaunchEnv } = require('../../support/helpers/electronLaunch');

async function launch(userData: string) {
  const args = buildElectronLaunchArgs(path.join(process.cwd(), 'out/main/index.js'), userData);
  if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu');
  const env = buildElectronLaunchEnv(process.env, { ELECTRON_USER_DATA: userData, POLYTRAY_ISOLATED_TEST: '1' });
  const app = await electron.launch({ args, env: Object.fromEntries(Object.entries(env).filter((entry) => typeof entry[1] === 'string')) });
  await app.firstWindow();
  for (let attempt = 0; attempt < 60; attempt++) {
    for (const window of app.windows()) {
      if (await window.locator('#search-input').isVisible().catch(() => false)) return { app, window };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await app.close();
  throw new Error('Visible main window did not become ready');
}

function writeTinyStl(filePath: string) {
  fs.writeFileSync(filePath, 'solid restore\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid restore\n');
}

test('startup rolls a committed restore forward after only part of renderer localStorage was applied', async () => {
  const owner = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-restore-e2e-'));
  const userData = path.join(owner, 'user-data');
  const library = path.join(owner, 'library');
  const importedLibrary = path.join(owner, 'restored-root');
  fs.mkdirSync(userData); fs.mkdirSync(library);
  fs.mkdirSync(importedLibrary);
  const modelPath = path.join(library, 'restore-me.stl');
  writeTinyStl(modelPath);
  writeTinyStl(path.join(importedLibrary, 'must-not-scan.stl'));
  let first: Awaited<ReturnType<typeof launch>> | undefined;
  let restarted: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    first = await launch(userData);
    await first.window.evaluate((root) => {
      localStorage.setItem('polytray-settings', JSON.stringify({ autoScan: false, watch: false, page_size: 50,
        slicerConfiguration: { applicationPath: '/local/Example.app', useSystemDefault: false } }));
      localStorage.setItem('polytray-library-state', JSON.stringify({ libraryFolders: [root], lastFolder: root }));
      localStorage.setItem('polytray-collections', JSON.stringify({ collections: [], activeCollectionId: null }));
    }, library);
    const scan = await first.window.evaluate((root) => window.polytray.scanFolder(root, {
      thumbnail_timeout: 10_000, scanning_batch_size: 10, watcher_stability: 500, page_size: 50, thumbnailColor: '#8888aa',
    }), library);
    expect(scan.state).toBe('completed');
    const file = await first.window.evaluate(async (target) => {
      const result = await window.polytray.getFiles({ limit: 50, offset: 0 });
      return result.files.find((entry) => entry.path === target) ?? null;
    }, modelPath);
    expect(file).toBeTruthy();
    await first.window.evaluate(({ id }) => window.polytray.updateFileMetadata({ id, tags: ['before'], notes: 'keep this note' }), { id: file.id });

    const restore = await first.window.evaluate(async ({ targetPath, library, importedLibrary }) => {
      const bridge = window.polytray as typeof window.polytray & {
        getMetadataRestoreSnapshot(snapshot: { rendererRevision: number; libraryRoots: string[]; collections: Array<{ id: string; name: string; paths: string[] }>; preferences: Record<string, unknown> }): Promise<{ rendererRevision: number; libraryRoots: string[]; collections: Array<{ id: string; name: string; paths: string[] }>; preferences: Record<string, unknown> }>;
        previewMetadataRestore(input: { backup: unknown; currentSnapshot: unknown; options?: unknown }): Promise<{ status: string; plan?: { transactionId: string } }>;
        commitMetadataRestore(transactionId: string): Promise<{ status: string; rendererState?: { libraryRoots: string[]; collections: Array<{ id: string; name: string; paths: string[] }>; settings: Record<string, unknown> } }>;
      };
      const currentSnapshot = await bridge.getMetadataRestoreSnapshot({
        rendererRevision: Number(localStorage.getItem('polytray-renderer-state-revision')) || 0,
        libraryRoots: [library], collections: [],
        preferences: JSON.parse(localStorage.getItem('polytray-settings') || '{}'),
      });
      const backup = {
        format: 'polytray-metadata-backup', version: 1, exportedAt: '2026-09-28T00:00:00.000Z', appVersion: '1.1.1',
        annotations: [{ path: targetPath, tags: ['after'], notes: 'imported note' }],
        pendingAnnotations: [{ path: '/foreign/restored.stl', tags: ['pending'], notes: null }],
        collections: [{ id: 'restore-collection', name: 'Restored', paths: [targetPath] }],
        libraryRoots: [library, importedLibrary], preferences: { lightMode: true, watch: false },
        manifest: { backupType: 'metadata-only', sourceModelsIncluded: false, statement: 'This is a metadata backup; source model files are not included.' },
      };
      const preview = await bridge.previewMetadataRestore({ backup, currentSnapshot, options: { replaceSettings: true, replaceRoots: true } });
      if (preview.status !== 'preview' || !preview.plan) throw new Error('restore preview failed');
      const result = await bridge.commitMetadataRestore(preview.plan.transactionId);
      if (result.status !== 'staged' || !result.rendererState) throw new Error('restore commit failed');
      // Simulate a process crash after one renderer-owned key changed and before acknowledgment.
      localStorage.setItem('polytray-library-state', JSON.stringify({ libraryFolders: result.rendererState.libraryRoots, lastFolder: targetPath.slice(0, targetPath.lastIndexOf('/')) }));
      return { transactionId: preview.plan.transactionId, expectedSettings: result.rendererState.settings };
    }, { targetPath: modelPath, library, importedLibrary });
    await first.app.close();
    first = undefined;

    restarted = await launch(userData);
    await expect.poll(async () => restarted!.window.evaluate(async () => (
      await (window.polytray as typeof window.polytray & {
        getMetadataRestoreStatus(): Promise<{ unresolved: boolean }>;
      }).getMetadataRestoreStatus()
    ).unresolved), { timeout: 15_000 }).toBe(false);
    const recovered = await restarted.window.evaluate(async () => {
      const status = await (window.polytray as typeof window.polytray & {
        getMetadataRestoreStatus(): Promise<{ unresolved: boolean; pendingAnnotationCount: number; conflicts: unknown[] }>;
      }).getMetadataRestoreStatus();
      const settings = JSON.parse(localStorage.getItem('polytray-settings') || '{}');
      const libraryState = JSON.parse(localStorage.getItem('polytray-library-state') || '{}');
      const collections = JSON.parse(localStorage.getItem('polytray-collections') || '{}');
      const files = await window.polytray.getFiles({ limit: 50, offset: 0 });
      return { status, settings, libraryState, collections, file: files.files[0] ?? null };
    });
    expect(recovered.status.unresolved, JSON.stringify(recovered.status)).toBe(false);
    expect(recovered.status.pendingAnnotationCount).toBe(1);
    expect(recovered.settings.lightMode).toBe(true);
    expect(recovered.settings.autoScan).toBe(false);
    expect(recovered.settings.watch).toBe(false);
    expect(recovered.settings.slicerConfiguration).toEqual({ applicationPath: '/local/Example.app', useSystemDefault: false });
    expect(recovered.libraryState.libraryFolders).toEqual([library, importedLibrary]);
    expect(recovered.collections.collections).toContainEqual({ id: 'restore-collection', name: 'Restored', filePaths: [modelPath] });
    expect(recovered.file.tags).toBe('["before","after"]');
    expect(recovered.file.notes).toBe('keep this note');
    expect((await restarted.window.evaluate(async () => (await window.polytray.getFiles({ limit: 50, offset: 0 })).files)).some((entry) => entry.path.endsWith('must-not-scan.stl'))).toBe(false);
  } finally {
    if (first) await first.app.close().catch(() => {});
    if (restarted) await restarted.app.close().catch(() => {});
    fs.rmSync(owner, { recursive: true, force: true });
  }
});
