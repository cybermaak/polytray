import test from 'node:test';
import assert from 'node:assert/strict';

import { ICON_PATHS } from '../../../src/renderer/components/iconPaths';

test('shared icon set exports the v1.1 toolbar and preview glyphs', () => {
  assert.deepEqual(
    Object.keys(ICON_PATHS).sort(),
    [
      'close',
      'expand',
      'preview',
      'rescan',
      'settings',
      'sortOrder',
      'theme',
      'thumbnailRefresh',
      'wireframe',
    ].sort(),
  );

  assert.ok(Array.isArray(ICON_PATHS.settings));
  assert.ok(ICON_PATHS.settings.length >= 2);
});
