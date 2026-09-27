import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchIsolatedApp } from '../../support/helpers/isolatedApp';

test('a 5k scan exposes the first indexed subtree before discovery completes', async () => {
  const owner = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-s02-stream-'));
  const root = path.join(owner, 'library');
  const firstDirectory = path.join(root, 'a-first');
  const delayedDirectory = path.join(root, 'z-delayed');
  fs.mkdirSync(firstDirectory, { recursive: true });
  fs.mkdirSync(delayedDirectory, { recursive: true });
  const firstPath = path.join(firstDirectory, 'first.stl');
  fs.writeFileSync(firstPath, 'solid first\nendsolid first\n');
  for (let index = 0; index < 4_999; index++) {
    fs.writeFileSync(path.join(delayedDirectory, `model-${String(index).padStart(5, '0')}.stl`), 'solid model\nendsolid model\n');
  }

  let isolated: Awaited<ReturnType<typeof launchIsolatedApp>> | null = null;
  try {
    isolated = await launchIsolatedApp({ mainEntry: path.join(process.cwd(), 'out/main/index.js') });
    const window = await isolated.app.firstWindow();
    await window.evaluate(({ firstDirectory, root }) => {
      const view = window as unknown as Window & {
        __scanStartedAt?: number;
        __scanFinished?: boolean;
        __scanResult?: { totalFiles: number };
        __scanError?: string;
        __scanProof?: { total: number | null; indexed: number; elapsedMs: number; paths: string[]; latestTotal: number | null };
      };
      view.__scanStartedAt = performance.now();
      view.__scanFinished = false;
      let queried = false;
      window.polytray.onScanProgress((progress) => {
        if (queried || progress.total !== null || !progress.indexed) return;
        queried = true;
        const elapsedMs = performance.now() - (view.__scanStartedAt ?? performance.now());
        void window.polytray.getFiles({ folder: firstDirectory, limit: 10, offset: 0 }).then((result) => {
          view.__scanProof = {
            total: progress.total,
            indexed: progress.indexed ?? progress.current,
            elapsedMs,
            paths: result.files.map((file) => file.path),
            latestTotal: progress.total,
          };
        });
      });
      void window.polytray.scanFolder(root).then(
        (result) => { view.__scanResult = result; view.__scanFinished = true; },
        (error) => { view.__scanError = String(error); view.__scanFinished = true; },
      );
    }, { firstDirectory, root });

    await expect.poll(async () => window.evaluate(() => Boolean((window as unknown as { __scanProof?: unknown }).__scanProof)))
      .toBe(true);
    const proof = await window.evaluate(() => (window as unknown as {
      __scanProof: { total: number | null; indexed: number; elapsedMs: number; paths: string[]; latestTotal: number | null };
      __scanFinished: boolean;
    }).__scanProof);
    expect(proof.total).toBeNull();
    expect(proof.indexed).toBeGreaterThan(0);
    expect(proof.paths).toContain(firstPath);
    expect(proof.elapsedMs).toBeLessThan(1_000);

    await expect.poll(async () => window.evaluate(() => (window as unknown as { __scanFinished: boolean }).__scanFinished))
      .toBe(true);
    const result = await window.evaluate(() => (window as unknown as {
      __scanResult: { totalFiles: number };
      __scanError?: string;
    }).__scanResult);
    expect(result).toBeTruthy();
    expect(result.totalFiles).toBe(5_000);
  } finally {
    if (isolated) await isolated.close();
    fs.rmSync(owner, { recursive: true, force: true });
  }
});
