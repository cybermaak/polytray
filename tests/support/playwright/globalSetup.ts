import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * Build the app once before any E2E file runs. Previously app.e2e.ts and viewer-idle.e2e.ts each
 * rebuilt in beforeAll, so other files only saw a fresh out/ when one of those ran first; a
 * filtered or repeated run (--grep, --repeat-each, a single file) could launch a stale build.
 * Set POLYTRAY_E2E_SKIP_BUILD=1 to reuse an out/ you just built.
 */
export default function globalSetup() {
  if (process.env.POLYTRAY_E2E_SKIP_BUILD === '1') return;
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: path.resolve(__dirname, '../../..'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`E2E global setup: npm run build failed (exit ${result.status ?? result.signal})`);
  }
}
