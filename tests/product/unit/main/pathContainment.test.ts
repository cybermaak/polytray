import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterContainedPaths,
  isPathContained,
} from '../../../../src/main/pathContainment';

test('isPathContained accepts exact and nested descendants only', () => {
  const root = '/library/models';

  assert.equal(isPathContained(root, '/library/models'), true);
  assert.equal(isPathContained(root, '/library/models/part.stl'), true);
  assert.equal(isPathContained(root, '/library/models/nested/part.stl'), true);

  assert.equal(isPathContained(root, '/library/models-archive/part.stl'), false);
  assert.equal(isPathContained(root, '/library/modelsheet/part.stl'), false);
});

test('filterContainedPaths drops sibling-prefix collisions', () => {
  const root = '/library/models';
  const candidates = [
    '/library/models/a.stl',
    '/library/models/nested/b.stl',
    '/library/models-archive/c.stl',
    '/library/modelsheet/d.stl',
  ];

  assert.deepEqual(filterContainedPaths(root, candidates), [
    '/library/models/a.stl',
    '/library/models/nested/b.stl',
  ]);
});

test('isPathContained understands virtual archive directories', () => {
  const root = '/library/bundle.zip::entry::nested';

  assert.equal(
    isPathContained(root, '/library/bundle.zip::entry::nested/part.stl'),
    true,
  );
  assert.equal(
    isPathContained(root, '/library/bundle.zip::entry::nested/deeper/part.obj'),
    true,
  );
  assert.equal(
    isPathContained(root, '/library/bundle.zip::entry::other/part.stl'),
    false,
  );
  assert.equal(
    isPathContained('/library/bundle.zip::entry::', '/library/bundle.zip::entry::root.stl'),
    true,
  );
  assert.equal(
    isPathContained('/library', '/library/bundle.zip::entry::nested/part.stl'),
    true,
  );
});
