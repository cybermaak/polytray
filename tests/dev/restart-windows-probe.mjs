/** One bounded P02 experiment. Transient instrumentation is restored even on failure. */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const originals = new Map();
function patch(file, edit) {
  const original = fs.readFileSync(file, 'utf8');
  originals.set(file, original);
  fs.writeFileSync(file, edit(original.replace(/\r\n/g, '\n')));
}
function replace(source, before, after) {
  if (!source.includes(before)) throw new Error(`Probe insertion missing: ${before.slice(0, 80)}`);
  return source.replace(before, after);
}
function command(args, env = {}) {
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
    stdio: 'inherit', shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  return result.status ?? 1;
}
try {
  patch('src/main/fileIndexing.ts', source => {
    source = `import fs from 'node:fs';\n` + source;
    source = replace(source, '  let groupedMutations: CommittedFileMutation[] | null = null;', `
  const p02Phases: unknown[] = [];
  function p02Record(phase: string, start: number, details: object = {}) {
    if (process.env.POLYTRAY_ISOLATED_TEST !== '1' || !process.env.POLYTRAY_SCAN_TEST_HEARTBEAT_PATH) return;
    const durationMs = performance.now() - start;
    if (durationMs < 20) return;
    let walBytes: number | null = null;
    try { walBytes = fs.statSync(db.name + '-wal').size; } catch { /* Private DB may have no WAL yet. */ }
    p02Phases.push({ phase, durationMs, walBytes, ...details });
    if (p02Phases.length > 100) p02Phases.shift();
    (globalThis as typeof globalThis & { __p02SqlPhases?: unknown[] }).__p02SqlPhases = p02Phases;
  }
  let groupedMutations: CommittedFileMutation[] | null = null;`);
    const start = source.indexOf('  function applyMetadataResult(');
    const end = source.indexOf('  function updateFileMetadata(', start);
    let metadata = source.slice(start, end);
    metadata = replace(metadata, '    const result = db.transaction(() => {', `
    const transactionStart = performance.now();
    let bodyMs = 0;
    let readMs = 0;
    let updateMs = 0;
    let revisionMs = 0;
    const result = db.transaction(() => {
      const bodyStart = performance.now();
      try {`);
    metadata = replace(metadata, '      if (!row) {', '      readMs = performance.now() - bodyStart;\n      if (!row) {');
    metadata = replace(metadata, '      updateEnrichment.run(', '      const updateStart = performance.now();\n      updateEnrichment.run(');
    metadata = replace(metadata, '      const mutation = makeMutation', '      updateMs = performance.now() - updateStart;\n      const revisionStart = performance.now();\n      const mutation = makeMutation');
    metadata = replace(metadata, "      return { status: 'updated' as const, contentRevision: input.expectedContentRevision, mutation };", "      revisionMs = performance.now() - revisionStart;\n      return { status: 'updated' as const, contentRevision: input.expectedContentRevision, mutation };\n      } finally { bodyMs = performance.now() - bodyStart; }");
    metadata = replace(metadata, '    })();', `    })();
    p02Record('metadata-transaction', transactionStart, {
      fileId: input.fileId, bodyMs, boundaryMs: performance.now() - transactionStart - bodyMs,
      readMs, updateMs, revisionMs,
    });`);
    metadata = replace(metadata, '      notify(mutation, mutation.affectedPaths);', "      const notifyStart = performance.now();\n      notify(mutation, mutation.affectedPaths);\n      p02Record('metadata-notify', notifyStart, { fileId: input.fileId });");
    source = source.slice(0, start) + metadata + source.slice(end);
    source = replace(source, '      const transaction = db.transaction(() => {', `
      let bodyMs = 0;
      const transaction = db.transaction(() => {
        const bodyStart = performance.now();
        try {`);
    source = replace(source, '      });\n      let chunkResult: ReturnType<typeof transaction>;', '        } finally { bodyMs = performance.now() - bodyStart; }\n      });\n      let chunkResult: ReturnType<typeof transaction>;');
    source = replace(source, '        chunkResult = transaction();', `        const transactionStart = performance.now();
        chunkResult = transaction();
        p02Record('index-transaction', transactionStart, {
          bodyMs, boundaryMs: performance.now() - transactionStart - bodyMs,
          count: batch.length,
        });`);
    return source;
  });
  patch('src/main/scanService.ts', source => replace(source, '      slowPhases,', `      slowPhases,
      sqlPhases: (globalThis as typeof globalThis & { __p02SqlPhases?: unknown[] }).__p02SqlPhases ?? [],`));
  patch('tests/product/e2e/scan-streaming.e2e.ts', source => {
    source = replace(source, '    expect(heartbeat.intervalMs).toBe(25);', `    const measurement = {
      ...heartbeat, totalScanMs: Date.now() - releasedAt,
      persistedRows: await window.evaluate(async () => (await window.polytray.getFiles({ limit: 1, offset: 0 })).total),
    };
    expect(measurement.persistedRows).toBe(5_000);
    await test.info().attach('p02-scan-measurement.json', { body: JSON.stringify(measurement), contentType: 'application/json' });
    console.info('[P02 scan comparison]', JSON.stringify(measurement));
    expect(heartbeat.intervalMs).toBe(25);`);
    return source;
  });
  if (process.argv.includes('--prepare-only')) {
    const result = command(['tsc', '--noEmit']);
    if (result) process.exitCode = result;
  } else {
    console.info('[P02 baseline] default WAL auto-checkpoint; unchanged durability');
    const baseline = command(['playwright', 'test', 'responsive-layout.e2e.ts', 'scan-streaming.e2e.ts', '--output=test-results/p02-baseline']);
    patch('src/main/database.ts', source => replace(source, '  db.pragma("journal_mode = WAL");', '  db.pragma("journal_mode = WAL");\n  db.pragma("wal_autocheckpoint = 128");'));
    console.info('[P02 comparison] WAL128 experiment; unchanged durability');
    const comparison = command(['playwright', 'test', 'scan-streaming.e2e.ts', '--output=test-results/p02-wal128']);
    console.info('[P02 exit statuses]', JSON.stringify({ baseline, comparison }));
    if (baseline || comparison) process.exitCode = 1;
  }
} finally {
  for (const [file, original] of originals) fs.writeFileSync(file, original);
}
