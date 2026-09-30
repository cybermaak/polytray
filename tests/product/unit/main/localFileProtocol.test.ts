import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  decodePolytrayLocalFilePath,
  isAllowedLocalFilePath,
  resolveAllowedPolytrayLocalFilePath,
  openRegularFileNoFollow,
} from '../../../../src/main/localFileProtocol';

test('decodePolytrayLocalFilePath decodes valid local protocol URLs', () => {
  const result = decodePolytrayLocalFilePath(
    'polytray://local/%2FUsers%2Fmaak%2FModels%2Fpart.stl?cacheBust=1',
  );

  assert.equal(result, '/Users/maak/Models/part.stl');
});

test('decodePolytrayLocalFilePath rejects non-local polytray URLs', () => {
  assert.equal(
    decodePolytrayLocalFilePath('polytray://remote/%2FUsers%2Fmaak%2FModels%2Fpart.stl'),
    null,
  );
});

test('isAllowedLocalFilePath allows indexed model paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-protocol-'));
  try {
    const model = path.join(root, 'a.stl');
    fs.writeFileSync(model, 'solid model\nendsolid model\n');
    assert.equal(isAllowedLocalFilePath(model, {
      thumbnailDir: path.join(root, 'thumbs'),
      isIndexedFilePath: (filePath) => filePath === model,
    }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('isAllowedLocalFilePath allows paths inside thumbnail directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-protocol-'));
  try {
    const thumbnailDir = path.join(root, 'thumbs');
    fs.mkdirSync(thumbnailDir);
    const thumbnail = path.join(thumbnailDir, 'abc123.png');
    fs.writeFileSync(thumbnail, 'png');
    assert.equal(isAllowedLocalFilePath(thumbnail, { thumbnailDir, isIndexedFilePath: () => false }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('isAllowedLocalFilePath rejects arbitrary local paths outside the allowlist', () => {
  const allowed = isAllowedLocalFilePath('/etc/passwd', {
    thumbnailDir: '/thumbs',
    isIndexedFilePath: () => false,
  });

  assert.equal(allowed, false);
});

test('isAllowedLocalFilePath rejects a thumbnail symlink that resolves outside the cache', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-protocol-'));
  try {
    const thumbnailDir = path.join(root, 'thumbnails');
    fs.mkdirSync(thumbnailDir);
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'private');
    const linkedThumbnail = path.join(thumbnailDir, 'linked.png');
    fs.symlinkSync(outside, linkedThumbnail);

    assert.equal(isAllowedLocalFilePath(linkedThumbnail, { thumbnailDir, isIndexedFilePath: () => false }), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('isAllowedLocalFilePath rejects an indexed model replaced by a symlink', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-protocol-'));
  try {
    const indexedPath = path.join(root, 'part.stl');
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'private');
    fs.symlinkSync(outside, indexedPath);

    assert.equal(isAllowedLocalFilePath(indexedPath, {
      thumbnailDir: path.join(root, 'thumbnails'),
      isIndexedFilePath: (filePath) => filePath === indexedPath,
    }), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('descriptor open refuses a file swapped to a symlink after validation', async (context) => {
  if (!fs.constants.O_NOFOLLOW) return context.skip('O_NOFOLLOW is unavailable on this platform');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-protocol-'));
  try {
    const model = path.join(root, 'part.stl');
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(model, 'model');
    fs.writeFileSync(outside, 'private');
    await assert.rejects(openRegularFileNoFollow(model, async (filePath, flags) => {
      fs.rmSync(model);
      fs.symlinkSync(outside, model);
      return fs.promises.open(filePath, flags);
    }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveAllowedPolytrayLocalFilePath returns null for disallowed requests', () => {
  const result = resolveAllowedPolytrayLocalFilePath(
    'polytray://local/%2Fetc%2Fpasswd',
    {
      thumbnailDir: '/thumbs',
      isIndexedFilePath: () => false,
    },
  );

  assert.equal(result, null);
});
