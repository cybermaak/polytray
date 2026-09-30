import fs from 'node:fs/promises';
import { test } from '@playwright/test';

/** Attach synthetic E2E state only after failure, without replacing the original error. */
export async function attachJsonFailureEvidence(label: string, probe: () => Promise<unknown>) {
  let probeTimer: NodeJS.Timeout | undefined;
  let writeTimer: NodeJS.Timeout | undefined;
  let attachTimer: NodeJS.Timeout | undefined;
  try {
    const evidence = await Promise.race([
      probe().catch(error => ({ probeError: String(error) })),
      new Promise<{ probeTimedOut: true }>(resolve => { probeTimer = setTimeout(() => resolve({ probeTimedOut: true }), 5000); }),
    ]);
    const outputPath = test.info().outputPath(`${label}.json`);
    await Promise.race([
      fs.writeFile(outputPath, JSON.stringify(evidence, null, 2)),
      new Promise<void>(resolve => { writeTimer = setTimeout(resolve, 2000); }),
    ]);
    await Promise.race([
      test.info().attach(`${label}.json`, { path: outputPath, contentType: 'application/json' }),
      new Promise<void>(resolve => { attachTimer = setTimeout(resolve, 2000); }),
    ]);
  } catch { /* Diagnostics must not replace the caller's failure. */ }
  finally {
    if (probeTimer) clearTimeout(probeTimer);
    if (writeTimer) clearTimeout(writeTimer);
    if (attachTimer) clearTimeout(attachTimer);
  }
}
