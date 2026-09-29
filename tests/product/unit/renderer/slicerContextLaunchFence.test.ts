import test from 'node:test';
import assert from 'node:assert/strict';
import { applySlicerContextLookupIfCurrent, beginSlicerContextRootRemoval, fenceCollectionScopeChange, isPathInsideRoot, SlicerContextLaunchFence } from '../../../../src/renderer/lib/slicerContextLaunchFence';

test('a newer user intent invalidates an older context-menu lookup', () => {
  const fence = new SlicerContextLaunchFence();
  const request = fence.beginLookup();
  assert.equal(fence.isCurrent(request), true);
  fence.noteUserIntent();
  assert.equal(fence.isCurrent(request), false);
  const newerRequest = fence.beginLookup();
  assert.equal(fence.isCurrent(request), false);
  assert.equal(fence.isCurrent(newerRequest), true);
});

test('a held context lookup cannot replace a newer browsing choice when it resolves', async () => {
  const fence = new SlicerContextLaunchFence();
  const generation = fence.beginLookup();
  let resolveLookup!: (value: string) => void;
  const lookup = new Promise<string>(resolve => { resolveLookup = resolve; });
  const applied: string[] = [];
  const applying = applySlicerContextLookupIfCurrent(fence, generation, () => lookup, value => applied.push(value));
  fence.noteUserIntent();
  resolveLookup('older model');
  assert.equal(await applying, false);
  assert.deepEqual(applied, []);
});

test('root removal intent covers nested folders without matching sibling prefixes', () => {
  assert.equal(isPathInsideRoot('/models/nested', '/models'), true);
  assert.equal(isPathInsideRoot('/models', '/models'), true);
  assert.equal(isPathInsideRoot('/models-old', '/models'), false);
  assert.equal(isPathInsideRoot('/models/nested', '/models/'), true);
  assert.equal(isPathInsideRoot('c:\\models\\nested', 'C:\\MODELS', true), true);
});

test('removing a root invalidates a context lookup even from the library-root view', () => {
  const fence = new SlicerContextLaunchFence();
  const lookup = fence.beginLookup();
  const clearsActiveFolder = beginSlicerContextRootRemoval(fence, null, '/models');
  assert.equal(clearsActiveFolder, false);
  assert.equal(fence.isCurrent(lookup), false);
});

test('collection changes invalidate lookups only when they change the active collection scope', () => {
  const fence = new SlicerContextLaunchFence();
  let lookup = fence.beginLookup();
  assert.equal(fenceCollectionScopeChange(fence, 'collection-a', 'collection-b', 'collection-b'), true);
  assert.equal(fence.isCurrent(lookup), false);

  lookup = fence.beginLookup();
  assert.equal(fenceCollectionScopeChange(fence, 'collection-a', 'collection-a'), true);
  assert.equal(fence.isCurrent(lookup), false);

  lookup = fence.beginLookup();
  assert.equal(fenceCollectionScopeChange(fence, 'collection-a', 'collection-b'), false);
  assert.equal(fence.isCurrent(lookup), true);
});
