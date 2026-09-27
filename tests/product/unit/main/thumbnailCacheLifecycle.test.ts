import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { THUMBNAIL_INVALIDATION_PATH_BATCH_SIZE } from '../../../../src/shared/types';
import { generateForCapturedThumbnailIdentity } from '../../../../src/main/thumbnailIdentity';

import {
  reconcileThumbnailCache,
  THUMBNAIL_CACHE_VERSION,
  createThumbnailInvalidationEvents,
  selectThumbnailCachePathsToRemove,
  selectThumbnailRowsForInvalidation,
  executeThumbnailInvalidation,
  createThumbnailCacheEpochStore,
  normalizeThumbnailInvalidationScope,
  removeThumbnailCacheFiles,
  readThumbnailRequestEpoch,
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
    assert.deepEqual(result.thumbnailPathsToClear, [path.join(dir, 'keep.png')]);
    assert.equal(fs.existsSync(path.join(dir, 'orphan.png')), false);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(dir, 'cache-meta.json'), 'utf8')).version,
      THUMBNAIL_CACHE_VERSION,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('thumbnail cache reconciliation reports missing indexed PNG references for database reset', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-thumb-missing-'));
  const presentPath = path.join(dir, 'present.png');
  const missingPath = path.join(dir, 'missing.png');
  try {
    fs.writeFileSync(presentPath, 'present');
    fs.writeFileSync(path.join(dir, 'cache-meta.json'), JSON.stringify({ version: THUMBNAIL_CACHE_VERSION }));
    const result = await reconcileThumbnailCache({
      thumbnailDir: dir,
      referencedThumbnailPaths: [presentPath, missingPath],
    });
    assert.equal(result.versionReset, false);
    assert.deepEqual(result.thumbnailPathsToClear, [missingPath]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('thumbnail cache reconciliation clears indexed paths outside the owned cache directory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-thumb-outside-'));
  const outsidePath = path.join(dir, '..', 'outside.png');
  try {
    fs.writeFileSync(path.join(dir, 'cache-meta.json'), JSON.stringify({ version: THUMBNAIL_CACHE_VERSION }));
    const result = await reconcileThumbnailCache({
      thumbnailDir: dir,
      referencedThumbnailPaths: [outsidePath],
    });
    assert.deepEqual(result.thumbnailPathsToClear, [outsidePath]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('thumbnail cache reconciliation invalidates cache symlinks without touching their external targets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-thumb-symlink-'));
  const outside = path.join(os.tmpdir(), `polytray-outside-${process.pid}.png`);
  const link = path.join(dir, 'linked.png');
  try {
    fs.writeFileSync(outside, 'external');
    fs.symlinkSync(outside, link);
    fs.writeFileSync(path.join(dir, 'cache-meta.json'), JSON.stringify({ version: THUMBNAIL_CACHE_VERSION }));
    const result = await reconcileThumbnailCache({ thumbnailDir: dir, referencedThumbnailPaths: [link] });
    assert.deepEqual(result.thumbnailPathsToClear, [link]);
    assert.equal(fs.existsSync(link), false);
    assert.equal(fs.existsSync(outside), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});

test('folder invalidation selects canonical physical and virtual descendants without sibling-prefix matches', () => {
  const rows = [
    { id: 1, path: '/models/a.stl', contentRevision: 1, thumbnail: null },
    { id: 2, path: '/models-old/a.stl', contentRevision: 1, thumbnail: null },
    { id: 3, path: '/models/archive.zip::entry::parts/a.stl', contentRevision: 1, thumbnail: null },
  ];
  const selected = selectThumbnailRowsForInvalidation(rows, { kind: 'folder', folderPath: '/models' });
  assert.deepEqual(selected.map((row) => row.id), [1, 3]);
});

test('selected-file invalidation uses exact canonical virtual identities', () => {
  const rows = [
    { id: 1, path: '/models/a.stl', contentRevision: 1, thumbnail: null },
    { id: 2, path: '/models/archive.zip::entry::parts/a.stl', contentRevision: 1, thumbnail: null },
    { id: 3, path: '/models/archive.zip::entry::parts/b.stl', contentRevision: 1, thumbnail: null },
  ];
  const selected = selectThumbnailRowsForInvalidation(rows, { kind: 'files', modelPaths: ['/models/a.stl', '/models/archive.zip::entry::parts/a.stl'] });
  assert.deepEqual(selected.map((row) => row.id), [1, 2]);
});

test('selective invalidation removes only absolute PNGs contained by the owned cache directory', () => {
  const rows = [
    { id: 1, path: '/models/a.stl', contentRevision: 1, thumbnail: '/user-data/thumbnails/a.png' },
    { id: 2, path: '/models/b.stl', contentRevision: 1, thumbnail: '/outside/b.png' },
    { id: 3, path: '/models/c.stl', contentRevision: 1, thumbnail: '/user-data/thumbnails/cache-meta.json' },
  ];
  assert.deepEqual(selectThumbnailCachePathsToRemove('/user-data/thumbnails', rows), ['/user-data/thumbnails/a.png']);
});

test('selective invalidation notices chunk both identity lists at 256 entries', () => {
  const modelPaths = Array.from({ length: THUMBNAIL_INVALIDATION_PATH_BATCH_SIZE * 2 + 1 }, (_, index) => `/models/${index}.stl`);
  const thumbnailPaths = Array.from({ length: THUMBNAIL_INVALIDATION_PATH_BATCH_SIZE + 1 }, (_, index) => `/cache/${index}.png`);
  const events = createThumbnailInvalidationEvents({ kind: 'files', modelPaths }, modelPaths, thumbnailPaths);
  assert.deepEqual(events.map((event) => event.kind), ['paths', 'paths', 'paths']);
  assert.deepEqual(events.map((event) => event.kind === 'paths' ? event.modelPaths.length : -1), [THUMBNAIL_INVALIDATION_PATH_BATCH_SIZE, THUMBNAIL_INVALIDATION_PATH_BATCH_SIZE, 1]);
  assert.deepEqual(events.map((event) => event.kind === 'paths' ? event.thumbnailPaths.length : -1), [THUMBNAIL_INVALIDATION_PATH_BATCH_SIZE, 1, 0]);
  assert.equal(events.every((event) => event.kind === 'all' || (event.modelPaths.length <= THUMBNAIL_INVALIDATION_PATH_BATCH_SIZE && event.thumbnailPaths.length <= THUMBNAIL_INVALIDATION_PATH_BATCH_SIZE)), true);
});

test('all invalidation uses one compact event without enumerating model or cache paths', () => {
  assert.deepEqual(createThumbnailInvalidationEvents({ kind: 'all' }, ['/models/a.stl'], ['/cache/a.png']), [{ kind: 'all' }]);
});


test('invalidation advances epochs and cancels queued work before clearing, deleting, notifying, and requeueing', async () => {
  const order: string[] = [];
  const rows = [{ id: 7, path: '/models/a.stl', contentRevision: 4, thumbnail: '/cache/a.png' }];
  const result = await executeThumbnailInvalidation({ kind: 'files', modelPaths: ['/models/a.stl'] }, rows, '/cache', {
    advanceEpochs(paths, all) { order.push(`epoch:${all}:${paths[0]}`); },
    cancelQueued(paths) { order.push(`cancel:${paths?.[0] ?? 'all'}`); },
    clearReferences(targets, all) { order.push(`clear:${all}:${targets.length}`); return targets.length; },
    removeCacheFiles(all, paths) { order.push(`remove:${all}:${paths[0]}`); return paths.length; },
    publish(event) { order.push(`publish:${event.kind}`); },
    queue(scope) { order.push(`queue:${scope.kind}`); },
  });
  assert.deepEqual(order, [
    'epoch:false:/models/a.stl',
    'cancel:/models/a.stl',
    'clear:false:1',
    'remove:false:/cache/a.png',
    'publish:paths',
    'queue:files',
  ]);
  assert.deepEqual(result, { invalidatedFileCount: 1, removedThumbnailCount: 1 });
});

test('a barrier-held manual completion cannot restore its pre-invalidation thumbnail path or failure state', async () => {
  const epochs = createThumbnailCacheEpochStore();
  const modelPath = '/models/a.stl';
  const row = { id: 1, path: modelPath, contentRevision: 9, thumbnailPath: '/cache/old.png', cacheEpoch: epochs.current(modelPath) };
  let databaseThumbnail: string | null = row.thumbnailPath;
  let thumbnailFailed = 0;
  let finishGeneration!: (value: string | null) => void;
  const heldGeneration = new Promise<string | null>((resolve) => { finishGeneration = resolve; });
  const manualRequest = generateForCapturedThumbnailIdentity(
    () => row,
    async () => heldGeneration,
    (captured) => captured.cacheEpoch === epochs.current(captured.path),
    (captured, resultPath) => {
      databaseThumbnail = resultPath ?? captured.thumbnailPath;
      thumbnailFailed = resultPath ? 0 : 1;
      return true;
    },
  );

  await executeThumbnailInvalidation({ kind: 'files', modelPaths: [modelPath] }, [{
    id: row.id, path: row.path, contentRevision: row.contentRevision, thumbnail: databaseThumbnail,
  }], '/cache', {
    advanceEpochs(paths, all) { epochs.advance(paths, all); },
    cancelQueued() {},
    clearReferences() { databaseThumbnail = null; thumbnailFailed = 0; return 1; },
    removeCacheFiles() { return 1; },
    publish() {},
    queue() {},
  });
  finishGeneration('/cache/late.png');

  assert.equal(await manualRequest, null);
  assert.equal(databaseThumbnail, null);
  assert.equal(thumbnailFailed, 0);
});

test('manual identity helper calls the publisher only after its current-state guard passes', async () => {
  let publisherCalls = 0;
  const result = await generateForCapturedThumbnailIdentity(
    () => ({ path: '/models/a.stl', cacheEpoch: 3 }),
    async () => '/cache/current.png',
    (captured) => captured.cacheEpoch === 3,
    () => { publisherCalls++; return true; },
  );
  assert.equal(result, '/cache/current.png');
  assert.equal(publisherCalls, 1);
});

test('global and per-path cache epochs fence old results without enumerating all indexed paths', () => {
  const epochs = createThumbnailCacheEpochStore();
  const oldA = epochs.current('/models/a.stl');
  const oldB = epochs.current('/models/b.stl');
  assert.equal(epochs.advance(['/models/a.stl']), 1);
  assert.notEqual(epochs.current('/models/a.stl'), oldA);
  assert.equal(epochs.current('/models/b.stl'), oldB);
  assert.equal(epochs.advance([], true), 2);
  assert.equal(epochs.current('/models/a.stl'), 2);
  assert.equal(epochs.current('/models/b.stl'), 2);
  assert.equal(epochs.advance(['/models/a.stl']), 3);
  assert.equal(epochs.current('/models/b.stl'), 2);
});

test('scheduled T01 request keys preserve their captured epoch and malformed keys fail closed', () => {
  assert.equal(readThumbnailRequestEpoch(JSON.stringify(['identity', 42])), 42);
  assert.equal(readThumbnailRequestEpoch(JSON.stringify(['identity', 0])), 0);
  assert.equal(readThumbnailRequestEpoch(JSON.stringify(['identity', '42'])), null);
  assert.equal(readThumbnailRequestEpoch('not-json'), null);
});

test('invalid thumbnail invalidation scopes are rejected at the service boundary', () => {
  assert.deepEqual(normalizeThumbnailInvalidationScope({ kind: 'all' }), { kind: 'all' });
  assert.deepEqual(normalizeThumbnailInvalidationScope({ kind: 'folder', folderPath: '/models' }), { kind: 'folder', folderPath: '/models' });
  assert.deepEqual(normalizeThumbnailInvalidationScope({ kind: 'files', modelPaths: ['/models/a.stl'] }), { kind: 'files', modelPaths: ['/models/a.stl'] });
  assert.throws(() => normalizeThumbnailInvalidationScope({ kind: 'folder' }), /Invalid thumbnail invalidation scope/);
  assert.throws(() => normalizeThumbnailInvalidationScope({ kind: 'files', modelPaths: ['/models/a.stl', null] }), /Invalid thumbnail invalidation scope/);
  assert.throws(() => normalizeThumbnailInvalidationScope({ kind: 'all', folderPath: '/models' }), /Invalid thumbnail invalidation scope/);
});

test('selective cache deletion removes only contained target PNGs and leaves unrelated files intact', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-thumb-selective-delete-'));
  const target = path.join(root, 'target.png');
  const unrelated = path.join(root, 'unrelated.png');
  const temp = path.join(root, 'active.tmp');
  const outside = path.join(root, '..', 'outside.png');
  try {
    fs.writeFileSync(target, 'target');
    fs.writeFileSync(unrelated, 'unrelated');
    fs.writeFileSync(temp, 'temp');
    fs.writeFileSync(outside, 'outside');
    const removed = await removeThumbnailCacheFiles(root, false, [target, outside]);
    assert.equal(removed, 1);
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.existsSync(unrelated), true);
    assert.equal(fs.existsSync(temp), true);
    assert.equal(fs.existsSync(outside), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});

test('full cache deletion removes PNGs and abandoned temp files only inside its owned directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-thumb-full-delete-'));
  const png = path.join(root, 'a.png');
  const temp = path.join(root, 'a.png.request.tmp');
  const meta = path.join(root, 'cache-meta.json');
  try {
    fs.writeFileSync(png, 'png');
    fs.writeFileSync(temp, 'temp');
    fs.writeFileSync(meta, '{}');
    assert.equal(await removeThumbnailCacheFiles(root, true, []), 1);
    assert.equal(fs.existsSync(png), false);
    assert.equal(fs.existsSync(temp), false);
    assert.equal(fs.existsSync(meta), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cache deletion keeps partial progress and logs an individual removal failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-thumb-partial-delete-'));
  const good = path.join(root, 'good.png');
  const blocked = path.join(root, 'blocked.png');
  const failures: string[] = [];
  try {
    fs.writeFileSync(good, 'good');
    fs.writeFileSync(blocked, 'blocked');
    const removed = await removeThumbnailCacheFiles(root, false, [good, blocked], {
      async removeFile(filePath) {
        if (filePath === blocked) throw new Error('simulated busy file');
        await fs.promises.rm(filePath, { force: true });
      },
      onError(filePath) { failures.push(filePath); },
    });
    assert.equal(removed, 1);
    assert.equal(fs.existsSync(good), false);
    assert.equal(fs.existsSync(blocked), true);
    assert.deepEqual(failures, [blocked]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a cache-delete hook failure still publishes invalidation and requeues the scope', async () => {
  const order: string[] = [];
  const row = { id: 1, path: '/models/a.stl', contentRevision: 3, thumbnail: '/cache/a.png' };
  const result = await executeThumbnailInvalidation({ kind: 'files', modelPaths: [row.path] }, [row], '/cache', {
    advanceEpochs() { order.push('epoch'); },
    cancelQueued() { order.push('cancel'); },
    clearReferences() { order.push('clear'); return 1; },
    async removeCacheFiles() { order.push('remove'); throw new Error('simulated directory IO failure'); },
    onCacheRemoveError(error) { order.push(`logged:${(error as Error).message}`); },
    publish() { order.push('publish'); },
    queue() { order.push('queue'); },
  });
  assert.deepEqual(order, ['epoch', 'cancel', 'clear', 'remove', 'logged:simulated directory IO failure', 'publish', 'queue']);
  assert.deepEqual(result, { invalidatedFileCount: 1, removedThumbnailCount: 0 });
});
