import test from 'node:test';
import assert from 'node:assert/strict';

import {
  libraryScrollRestoreTarget,
  reuseRestoredLibraryScrollAnchor,
  shouldCaptureLibraryScrollAnchor,
  type LibraryScrollAnchor,
} from '../../../../src/renderer/lib/libraryScrollAnchor';

const anchor: LibraryScrollAnchor = { itemKey: 'file:4', itemIndex: 4, columns: 4, rowStep: 338, scrollTop: 500 };

test('restore target moves by whole rows when items are inserted above the anchor', () => {
  // file:4 moved from row 1 to row 31 (index 124 of a 4-column grid).
  assert.equal(libraryScrollRestoreTarget(anchor, 124), 500 + 30 * 338);
  assert.equal(libraryScrollRestoreTarget(anchor, 7), 500, 'same row keeps the position');
  assert.equal(libraryScrollRestoreTarget(anchor, -1), 500, 'a missing anchor keeps the old position');
  assert.equal(libraryScrollRestoreTarget({ ...anchor, scrollTop: 0, itemIndex: 40 }, 0), 0, 'never negative');
});

test('a pending anchor is kept until its refresh settles and its restore frame runs', () => {
  assert.equal(shouldCaptureLibraryScrollAnchor({ hasPendingAnchor: false, refreshing: true, restoreFramePending: true }), true);
  assert.equal(shouldCaptureLibraryScrollAnchor({ hasPendingAnchor: true, refreshing: true, restoreFramePending: false }), false);
  assert.equal(shouldCaptureLibraryScrollAnchor({ hasPendingAnchor: true, refreshing: false, restoreFramePending: true }), false);
  assert.equal(shouldCaptureLibraryScrollAnchor({ hasPendingAnchor: true, refreshing: false, restoreFramePending: false }), true,
    'a pending anchor whose refresh never ran is stale');
});

test('the restored anchor is reused while the user has not scrolled since the restore', () => {
  const restored = { ...anchor, itemIndex: 38, scrollTop: 3204 };
  assert.deepEqual(reuseRestoredLibraryScrollAnchor(restored, 3204, 38), restored);
  assert.deepEqual(reuseRestoredLibraryScrollAnchor(restored, 3204.5, 40), { ...restored, itemIndex: 40, scrollTop: 3204.5 });
  assert.equal(reuseRestoredLibraryScrollAnchor(restored, 3600, 38), null, 'a user scroll picks a new anchor');
  assert.equal(reuseRestoredLibraryScrollAnchor(restored, 3204, -1), null, 'a removed card picks a new anchor');
  assert.equal(reuseRestoredLibraryScrollAnchor(null, 3204, 38), null);
});

test('streaming inserts keep the original card in place instead of drifting to inserted cards', () => {
  // Batches of files sort above file:4. Re-anchoring to whichever card tops the viewport would
  // adopt an inserted card sharing file:4's row and let later inserts push file:4 away; reusing
  // the restored anchor keeps following file:4 across every batch.
  let current: LibraryScrollAnchor = anchor;
  for (const nextIndex of [38, 95, 124]) {
    const scrollTop = libraryScrollRestoreTarget(current, nextIndex);
    const restored = { ...current, itemIndex: nextIndex, scrollTop };
    current = reuseRestoredLibraryScrollAnchor(restored, scrollTop, nextIndex)!;
    assert.equal(current.itemKey, 'file:4');
  }
  assert.equal(current.scrollTop, 500 + (Math.floor(124 / 4) - Math.floor(4 / 4)) * 338);
});
