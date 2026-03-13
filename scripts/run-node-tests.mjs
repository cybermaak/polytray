import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function collectTestFiles(targetPath, collected) {
  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(targetPath)) {
      collectTestFiles(path.join(targetPath, entry), collected);
    }
    return;
  }

  if (targetPath.endsWith('.test.ts')) {
    collected.push(targetPath);
  }
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('Usage: node scripts/run-node-tests.mjs <path> [path...]');
  process.exit(1);
}

const files = [];
for (const target of targets) {
  collectTestFiles(path.resolve(target), files);
}
files.sort();

if (files.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
