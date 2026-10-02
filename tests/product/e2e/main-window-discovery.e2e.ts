import { test, expect } from '@playwright/test';
import path from 'node:path';
import type { ElectronApplication } from 'playwright';
import { findMainWindow, launchIsolatedApp } from '../../support/helpers/isolatedApp';

test('main window discovery ignores a hidden renderer returned first', async () => {
  const isolated = await launchIsolatedApp({ mainEntry: path.resolve('out/main/index.js') });
  try {
    await isolated.app.firstWindow();
    await expect.poll(() => isolated.app.windows().some(page => page.url().endsWith('/thumbnail.html'))).toBe(true);
    const thumbnail = isolated.app.windows().find(page => page.url().endsWith('/thumbnail.html'))!;
    const hiddenFirst = {
      firstWindow: async () => thumbnail,
      windows: () => isolated.app.windows(),
    } as unknown as ElectronApplication;

    const page = await findMainWindow(hiddenFirst);
    expect(page.url()).toMatch(/\/index\.html$/);
    await expect(page.locator('#search-input')).toBeVisible();
    expect(await page.evaluate(() => typeof window.polytray?.getFiles)).toBe('function');
  } finally {
    await isolated.close();
  }
});
