import test from 'node:test';
import assert from 'node:assert/strict';
import { createSlicerContextMenuAction, sendSlicerContextMenuRequest } from '../../../../src/main/slicerContextMenu';

test('slicer context menu action exists only for supported indexed models and sends captured identity', () => {
  const indexed = {
    fileId: 7,
    path: '/models/part.stl',
    extension: 'stl',
    contentRevision: 12,
  };
  const sent: unknown[] = [];

  const action = createSlicerContextMenuAction(indexed, identity => sent.push(identity));
  assert.equal(action?.label, 'Open in Slicer');
  action?.click();
  assert.deepEqual(sent, [indexed]);
  assert.equal(createSlicerContextMenuAction(null, () => undefined), null);
  assert.equal(createSlicerContextMenuAction({ ...indexed, extension: 'txt' }, () => undefined), null);
});

test('slicer context menu rechecks the indexed identity at click time', () => {
  const captured = { fileId: 7, path: '/models/part.stl', extension: 'stl', contentRevision: 12 };
  const sent: unknown[] = [];
  assert.equal(sendSlicerContextMenuRequest(captured, () => ({ ...captured, contentRevision: 13 }), file => sent.push(file)), false);
  assert.deepEqual(sent, []);
  assert.equal(sendSlicerContextMenuRequest(captured, () => captured, file => sent.push(file)), true);
  assert.deepEqual(sent, [captured]);
});
