import { defineConfig } from '@playwright/test';

const captureBuildFailures = Boolean(process.env.CI && (
  process.env.GITHUB_WORKFLOW === 'Build' || process.env.GITHUB_WORKFLOW === 'E2E Stability'
));

export default defineConfig({
  testDir: './tests/product/e2e',
  testMatch: '**/*.e2e.ts',
  globalSetup: './tests/support/playwright/globalSetup.ts',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: captureBuildFailures ? 'retain-on-failure' : 'on-first-retry',
    screenshot: captureBuildFailures ? 'only-on-failure' : 'off',
  },
});
