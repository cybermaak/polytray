import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodePolytrayLocalFilePath,
  isAllowedLocalFilePath,
  resolveAllowedPolytrayLocalFilePath,
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
  const allowed = isAllowedLocalFilePath('/models/a.stl', {
    thumbnailDir: '/thumbs',
    isIndexedFilePath: (filePath) => filePath === '/models/a.stl',
  });

  assert.equal(allowed, true);
});

test('isAllowedLocalFilePath allows paths inside thumbnail directory', () => {
  const allowed = isAllowedLocalFilePath('/thumbs/abc123.png', {
    thumbnailDir: '/thumbs',
    isIndexedFilePath: () => false,
  });

  assert.equal(allowed, true);
});

test('isAllowedLocalFilePath rejects arbitrary local paths outside the allowlist', () => {
  const allowed = isAllowedLocalFilePath('/etc/passwd', {
    thumbnailDir: '/thumbs',
    isIndexedFilePath: () => false,
  });

  assert.equal(allowed, false);
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
