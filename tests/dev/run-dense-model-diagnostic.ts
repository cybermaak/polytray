import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { createModelFixtures } from '../support/fixtures/performanceFixtures';

async function main() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-dense-diagnostic-'));
  try {
    const fixtures = await createModelFixtures(scratch, { denseTriangleCount: 200_000 });
    const buffer = fs.readFileSync(fixtures.files['dense-single-mesh.stl']);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const started = performance.now();
    const geometry = new STLLoader().parse(arrayBuffer);
    const result = { triangles: geometry.getAttribute('position').count / 3, fixtureBytes: buffer.byteLength, parseMs: performance.now() - started, runtime: `Electron ${process.versions.electron} / Node ${process.version} STLLoader` };
    geometry.dispose();
    console.log(JSON.stringify(result));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

void main();
