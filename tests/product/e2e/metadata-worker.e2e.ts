import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchIsolatedApp } from '../../support/helpers/isolatedApp';

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

test('large OBJ metadata uses the utility worker and the app quits cleanly afterward', async () => {
  const env: NodeJS.ProcessEnv = {};
  let heartbeatPath = '';
  let libraryPath = '';
  const isolated = await launchIsolatedApp({
    mainEntry: path.join(process.cwd(), 'out/main/index.js'),
    env,
    beforeLaunch: ({ scratchDir }) => {
      heartbeatPath = path.join(scratchDir, 'main-heartbeat.json');
      libraryPath = path.join(scratchDir, 'library');
      env.POLYTRAY_SCAN_TEST_HEARTBEAT_PATH = heartbeatPath;
      fs.mkdirSync(libraryPath);
      const fd = fs.openSync(path.join(libraryPath, 'large.obj'), 'w');
      try {
        const chunk = Array.from({ length: 20_000 }, (_, index) => `v ${index % 101} ${index % 73} ${index % 47}\n`).join('');
        for (let batch = 0; batch < 60; batch++) fs.writeSync(fd, chunk);
        fs.writeSync(fd, 'f 1 2 3\n');
      } finally { fs.closeSync(fd); }
    },
  });
  try {
    const window = await findMainWindow(isolated.app);
    const result = await window.evaluate(async (root) => window.polytray.scanFolder(root, {
      thumbnail_timeout: 10_000, scanning_batch_size: 10, watcher_stability: 500,
      page_size: 50, thumbnailColor: '#808080',
    }), libraryPath);
    expect(result.state).toBe('completed');
    expect(result.metadataCompleted).toBe(1);
    await expect.poll(() => fs.existsSync(heartbeatPath)).toBe(true);
    const heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8')) as {
      intervalMs: number; samples: number; maxGapMs: number | null;
    };
    expect(heartbeat.intervalMs).toBe(25);
    expect(heartbeat.samples).toBeGreaterThan(0);
    expect(heartbeat.maxGapMs).not.toBeNull();
    expect(heartbeat.maxGapMs!).toBeLessThanOrEqual(250);
  } finally {
    // Closing the isolated Electron app exercises metadata-worker shutdown on quit.
    await isolated.close();
  }
});
