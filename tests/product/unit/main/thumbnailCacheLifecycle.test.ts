import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  reconcileThumbnailCache,
  THUMBNAIL_CACHE_VERSION,
} from '../../../../src/main/thumbnailCacheLifecycle';

test('thumbnail cache lifecycle prunes orphaned files and rewrites stale cache versions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-thumb-cache-'));

  try {
    fs.writeFileSync(path.join(dir, 'keep.png'), 'keep');
    fs.writeFileSync(path.join(dir, 'orphan.png'), 'orphan');
    fs.writeFileSync(
      path.join(dir, 'cache-meta.json'),
      JSON.stringify({ version: THUMBNAIL_CACHE_VERSION - 1 }),
    );

    const result = await reconcileThumbnailCache({
      thumbnailDir: dir,
      referencedThumbnailPaths: [path.join(dir, 'keep.png')],
    });

    assert.equal(result.versionReset, true);
    assert.equal(fs.existsSync(path.join(dir, 'orphan.png')), false);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(dir, 'cache-meta.json'), 'utf8')).version,
      THUMBNAIL_CACHE_VERSION,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
