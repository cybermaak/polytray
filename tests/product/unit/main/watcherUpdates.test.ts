import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWatcherNotificationBatcher,
  createWatcherRootAvailabilityTracker,
  createWatcherRootStatusPoller,
  createWatcherUpdateCoordinator,
  type WatcherRootPollTimer,
} from '../../../../src/main/watcherLifecycle';

interface Identity { id: number; path: string; contentRevision: number; }
interface Stat { size: number; modifiedAt: number; }
interface Metadata { vertices: number; }

function makeHarness() {
  const rows = new Map<string, Identity & { size: number; modifiedAt: number; metadata?: Metadata; thumbnail?: string | null }>();
  const operations: string[] = [];
  const committedRevisions: number[] = [];
  let nextId = 1;
  let nextRevision = 1;
  let observedSize = 10;
  let removalSafe = true;
  let throwThumbnailWrite = false;
  const metadataGates: Array<() => void> = [];
  const thumbnailGates: Array<() => void> = [];
  const coordinator = createWatcherUpdateCoordinator<Stat, Metadata>({
    stat: async () => ({ size: observedSize, modifiedAt: 100 }),
    getIdentity: (filePath) => rows.get(filePath) ?? null,
    commit: (event, stat) => {
      operations.push(`commit:${event.type}`);
      if (event.type === 'unlink') {
        rows.delete(event.filePath);
        return null;
      }
      const old = rows.get(event.filePath);
      const changed = !old || event.type === 'change' || old.size !== stat.size || old.modifiedAt !== stat.modifiedAt;
      const identity = old
        ? { ...old, contentRevision: changed ? ++nextRevision : old.contentRevision, size: stat.size, modifiedAt: stat.modifiedAt }
        : { id: nextId++, path: event.filePath, contentRevision: ++nextRevision, size: stat.size, modifiedAt: stat.modifiedAt };
      rows.set(event.filePath, identity);
      committedRevisions.push(identity.contentRevision);
      return identity;
    },
    remove: (identity) => {
      operations.push('remove');
      if (rows.get(identity.path)?.contentRevision === identity.contentRevision) rows.delete(identity.path);
    },
    isRemovalSafe: async () => removalSafe,
    extractMetadata: async (identity) => {
      operations.push(`metadata:${identity.contentRevision}`);
      await new Promise<void>((resolve) => { metadataGates.push(resolve); });
      return { vertices: identity.contentRevision };
    },
    applyMetadata: (identity, metadata) => {
      const current = rows.get(identity.path);
      if (!current || current.id !== identity.id || current.contentRevision !== identity.contentRevision) return false;
      current.metadata = metadata;
      operations.push(`metadata-write:${identity.contentRevision}`);
      return true;
    },
    generateThumbnail: async (identity) => {
      operations.push(`thumbnail:${identity.contentRevision}`);
      await new Promise<void>((resolve) => { thumbnailGates.push(resolve); });
      return `thumb-${identity.contentRevision}.png`;
    },
    applyThumbnail: (identity, thumbnailPath) => {
      if (throwThumbnailWrite) throw new Error('thumbnail persistence failed');
      const current = rows.get(identity.path);
      if (!current || current.id !== identity.id || current.contentRevision !== identity.contentRevision) return false;
      current.thumbnail = thumbnailPath;
      operations.push(`thumbnail-write:${identity.contentRevision}`);
      return true;
    },
    onCommitted: (event) => operations.push(`notify:${event.type}`),
  });
  return {
    rows, operations, coordinator,
    setObservedSize(size: number) { observedSize = size; },
    setRemovalSafe(safe: boolean) { removalSafe = safe; },
    setThrowThumbnailWrite(shouldThrow: boolean) { throwThumbnailWrite = shouldThrow; },
    committedRevisions,
    releaseEnrichment() {
      for (const release of [...metadataGates, ...thumbnailGates]) release();
      metadataGates.length = 0;
      thumbnailGates.length = 0;
    },
  };
}

test('watcher commits identity before scheduling enrichment and stale work cannot publish after unlink', async () => {
  const harness = makeHarness();
  const filePath = '/models/new.stl';
  await harness.coordinator.handle({ type: 'add', filePath });
  assert.equal(harness.rows.has(filePath), true);
  assert.deepEqual(harness.operations.slice(0, 3), ['commit:add', 'notify:add', 'metadata:2']);

  await harness.coordinator.handle({ type: 'unlink', filePath });
  harness.releaseEnrichment();
  await harness.coordinator.drain();
  assert.equal(harness.rows.has(filePath), false);
  assert.equal(harness.operations.some((operation) => operation.startsWith('metadata-write:')), false);
  assert.equal(harness.operations.some((operation) => operation.startsWith('thumbnail-write:')), false);
});

test('same-path add/change/unlink bursts commit in order and size changes advance identity', async () => {
  const harness = makeHarness();
  const filePath = '/models/burst.stl';
  const first = harness.coordinator.handle({ type: 'add', filePath });
  harness.setObservedSize(20);
  const second = harness.coordinator.handle({ type: 'change', filePath });
  await Promise.all([first, second]);
  assert.deepEqual(harness.operations.filter((operation) => operation.startsWith('commit:')),
    ['commit:change']);
  assert.equal(harness.committedRevisions.length, 1);
  assert.equal(harness.rows.get(filePath)?.size, 20);
  const third = harness.coordinator.handle({ type: 'unlink', filePath });
  await third;
  assert.equal(harness.rows.has(filePath), false);
  harness.releaseEnrichment();
  await harness.coordinator.drain();
  assert.equal(harness.operations.some((operation) => operation.startsWith('thumbnail-write:')), false);
});

test('same-path commits that have already started serialize explicit changes at the same timestamp', async () => {
  const harness = makeHarness();
  const filePath = '/models/serialized.stl';
  await harness.coordinator.handle({ type: 'add', filePath });
  harness.setObservedSize(20);
  await harness.coordinator.handle({ type: 'change', filePath });
  assert.deepEqual(harness.operations.filter((operation) => operation.startsWith('commit:')),
    ['commit:add', 'commit:change']);
  assert.ok(harness.committedRevisions[1] > harness.committedRevisions[0]);
  await harness.coordinator.handle({ type: 'unlink', filePath });
  assert.equal(harness.rows.has(filePath), false);
  harness.releaseEnrichment();
  await harness.coordinator.drain();
  assert.equal(harness.operations.some((operation) => operation.startsWith('thumbnail-write:')), false);
});

test('a size difference on an add event advances the indexed content revision', async () => {
  const harness = makeHarness();
  const filePath = '/models/size-change.stl';
  await harness.coordinator.handle({ type: 'add', filePath });
  const initialRevision = harness.rows.get(filePath)!.contentRevision;
  harness.setObservedSize(20);
  await harness.coordinator.handle({ type: 'add', filePath });
  assert.ok(harness.rows.get(filePath)!.contentRevision > initialRevision);
  harness.releaseEnrichment();
  await harness.coordinator.drain();
});

test('unlink events preserve indexed rows while their configured root is unavailable', async () => {
  const harness = makeHarness();
  const filePath = '/models/offline.stl';
  await harness.coordinator.handle({ type: 'add', filePath });
  harness.setRemovalSafe(false);
  await harness.coordinator.handle({ type: 'unlink', filePath });
  assert.equal(harness.rows.has(filePath), true);
  assert.equal(harness.operations.includes('remove'), false);
  harness.releaseEnrichment();
  await harness.coordinator.drain();
});

test('restart invalidation prevents a queued watcher event from committing later', async () => {
  const rows = new Map<string, Identity>();
  let releaseStat!: (stat: Stat | null) => void;
  let markStatStarted!: () => void;
  const statStarted = new Promise<void>((resolve) => { markStatStarted = resolve; });
  let commits = 0;
  const coordinator = createWatcherUpdateCoordinator<Stat, Metadata>({
    stat: () => new Promise((resolve) => { releaseStat = resolve; markStatStarted(); }),
    getIdentity: (filePath) => rows.get(filePath) ?? null,
    commit: (event) => {
      commits++;
      const identity = { id: 1, path: event.filePath, contentRevision: 1 };
      rows.set(event.filePath, identity);
      return identity;
    },
    remove: (identity) => { rows.delete(identity.path); },
    isRemovalSafe: async () => true,
    extractMetadata: async () => ({ vertices: 1 }),
    applyMetadata: () => true,
    generateThumbnail: async () => 'thumb.png',
    applyThumbnail: () => true,
  });
  const filePath = '/models/reconfigured.stl';
  const pending = coordinator.handle({ type: 'add', filePath });
  await statStarted;
  coordinator.invalidatePending();
  releaseStat({ size: 10, modifiedAt: 1 });
  await pending;
  await coordinator.drain();
  assert.equal(commits, 0);
  assert.equal(rows.has(filePath), false);
  assert.equal(coordinator.getTrackedPathCount(), 0);
});

test('root status polling owns one unref timer, avoids overlapping checks, and clears on stop', async () => {
  const callbacks = new Map<WatcherRootPollTimer, () => void>();
  const resolvers: Array<() => void> = [];
  const checks: string[] = [];
  let starts = 0;
  let clears = 0;
  let unrefs = 0;
  const poller = createWatcherRootStatusPoller(['/library', '/models'], async (rootPath) => {
    checks.push(rootPath);
    await new Promise<void>((resolve) => resolvers.push(resolve));
  }, 500, (callback) => {
    starts++;
    const timer: WatcherRootPollTimer = { unref: () => { unrefs++; } };
    callbacks.set(timer, callback);
    return timer;
  }, (timer) => {
    clears++;
    callbacks.delete(timer);
  });

  poller.start();
  poller.start();
  assert.equal(starts, 1);
  assert.equal(unrefs, 1);
  assert.equal(poller.isRunning(), true);
  const [timer, tick] = [...callbacks.entries()][0];
  tick();
  assert.deepEqual(checks, ['/library', '/models']);
  tick();
  assert.deepEqual(checks, ['/library', '/models']);
  for (const resolve of resolvers.splice(0)) resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  tick();
  assert.deepEqual(checks, ['/library', '/models', '/library', '/models']);
  for (const resolve of resolvers.splice(0)) resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));

  poller.stop();
  assert.equal(clears, 1);
  assert.equal(poller.isRunning(), false);
  tick();
  assert.equal(checks.length, 4);
  poller.start();
  assert.equal(starts, 2);
  assert.equal(unrefs, 2);
  poller.stop();
  assert.equal(clears, 2);
  assert.equal(callbacks.size, 0);
  assert.ok(timer);
});

test('an offline root recovery survives watcher stop and reconfigure before the next root check', () => {
  const roots = createWatcherRootAvailabilityTracker();
  roots.retainConfiguredRoots(['/library']);
  assert.deepEqual(roots.observe('/library', false), { changed: true, recovered: false });

  // stopWatcher leaves configured-root availability intact; starting again for
  // the same root must remember the observed outage until the new worker checks it.
  roots.retainConfiguredRoots(['/library']);
  assert.deepEqual(roots.observe('/library', true), { changed: true, recovered: true });

  // Removing the root from configuration forgets its prior status.
  roots.retainConfiguredRoots([]);
  roots.retainConfiguredRoots(['/library']);
  assert.deepEqual(roots.observe('/library', true), { changed: true, recovered: false });
});

test('settled paths are released and burst notifications collapse to the latest event', async () => {
  const harness = makeHarness();
  for (let index = 0; index < 40; index++) {
    const filePath = `/models/independent-${index}.stl`;
    await harness.coordinator.handle({ type: 'add', filePath });
  }
  harness.releaseEnrichment();
  await harness.coordinator.drain();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.coordinator.getTrackedPathCount(), 0);

  const published: string[][] = [];
  const batcher = createWatcherNotificationBatcher((values: string[]) => published.push(values), 60_000);
  batcher.enqueue('/models/a.stl', 'add');
  batcher.enqueue('/models/b.stl', 'add');
  batcher.enqueue('/models/a.stl', 'unlink');
  batcher.flush();
  assert.deepEqual(published, [['unlink', 'add']]);
  batcher.dispose();
});

test('thumbnail persistence rejection is logged, drained, and cleaned without an unhandled rejection', async () => {
  const harness = makeHarness();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    harness.setThrowThumbnailWrite(true);
    await harness.coordinator.handle({ type: 'add', filePath: '/models/thumbnail-write-failure.stl' });
    harness.releaseEnrichment();
    await assert.doesNotReject(harness.coordinator.drain());
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
    assert.equal(harness.coordinator.getTrackedPathCount(), 0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
