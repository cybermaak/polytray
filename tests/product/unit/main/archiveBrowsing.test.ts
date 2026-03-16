import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

import { scanFolder } from '../../../../src/main/scanner';
import { extractMetadata } from '../../../../src/main/metadata';
import { ARCHIVE_ENTRY_SEPARATOR } from '../../../../src/shared/archivePaths';

async function createArchiveFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-archive-'));
  const archivePath = path.join(tempDir, 'fixture-bundle.zip');
  const zip = new JSZip();
  zip.file(
    'nested/archived_cube.obj',
    `v 0 0 0\nv 2 0 0\nv 0 3 0\nf 1 2 3\n`,
  );
  zip.file(
    'archived_plate.stl',
    `solid plate\nfacet normal 0 0 1\n  outer loop\n    vertex 0 0 0\n    vertex 4 0 0\n    vertex 0 2 0\n  endloop\nendfacet\nendsolid plate\n`,
  );
  fs.writeFileSync(archivePath, await zip.generateAsync({ type: 'nodebuffer' }));
  return { tempDir, archivePath };
}

test('scanFolder indexes supported model files inside zip archives', async () => {
  const { tempDir, archivePath } = await createArchiveFixture();

  try {
    const files = await scanFolder(tempDir);
    const archiveFiles = files.filter((file) => file.path.startsWith(archivePath));

    assert.equal(archiveFiles.length, 2);
    assert.equal(
      archiveFiles.some((file) => file.path === `${archivePath}${ARCHIVE_ENTRY_SEPARATOR}archived_plate.stl`),
      true,
    );
    assert.equal(
      archiveFiles.some((file) => file.path === `${archivePath}${ARCHIVE_ENTRY_SEPARATOR}nested/archived_cube.obj`),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('extractMetadata reads geometry metadata from archive-backed virtual paths', async () => {
  const { tempDir, archivePath } = await createArchiveFixture();

  try {
    const metadata = await extractMetadata(
      `${archivePath}${ARCHIVE_ENTRY_SEPARATOR}nested/archived_cube.obj`,
      'obj',
    );

    assert.equal(metadata.vertexCount, 3);
    assert.equal(metadata.faceCount, 1);
    assert.deepEqual(metadata.dimensions, { x: 2, y: 3, z: 0 });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
