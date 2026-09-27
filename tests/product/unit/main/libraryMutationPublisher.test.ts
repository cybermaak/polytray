import test from 'node:test';
import assert from 'node:assert/strict';
import type { CommittedFileMutation } from '../../../../src/main/fileIndexing';
import { createLibraryMutationPublisher } from '../../../../src/main/libraryMutationPublisher';

function mutation(overrides: Partial<CommittedFileMutation> = {}): CommittedFileMutation {
  return {
    affectedPaths: ['/models/a.stl'],
    paths: ['/models/a.stl'],
    rowsChanged: true,
    annotationsChanged: false,
    statsChanged: true,
    topologyChanged: false,
    thumbnailOnly: false,
    browseRevision: 1,
    ...overrides,
  };
}

test('publisher sends the first mutation immediately and coalesces later changes at four per second', () => {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { callback: () => void; at: number }>();
  const sent: CommittedFileMutation[] = [];
  const publisher = createLibraryMutationPublisher({
    send: (value) => sent.push(value),
    now: () => now,
    setTimer: (callback, delay) => {
      const id = ++nextId;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimer: (handle) => { timers.delete(handle as number); },
  });

  publisher.publish(mutation());
  publisher.publish(mutation({
    affectedPaths: ['/models/b.stl'], paths: ['/models/b.stl'],
    rowsChanged: true, statsChanged: false, topologyChanged: true, browseRevision: 2,
  }));
  publisher.publish(mutation({
    affectedPaths: ['/models/a.stl'], paths: ['/models/a.stl'],
    rowsChanged: false, statsChanged: false, topologyChanged: false, thumbnailOnly: true, browseRevision: 2,
  }));
  assert.equal(sent.length, 1);

  now = 249;
  for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  assert.equal(sent.length, 1);
  now = 250;
  for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }

  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].affectedPaths, ['/models/b.stl', '/models/a.stl']);
  assert.equal(sent[1].browseRevision, 2);
  assert.equal(sent[1].rowsChanged, true);
  assert.equal(sent[1].topologyChanged, true);
  assert.equal(sent[1].thumbnailOnly, false);
  publisher.dispose();
});

test('publisher flushes terminal changes immediately and discards pending work on dispose', () => {
  let now = 0;
  let timerCallback: (() => void) | null = null;
  const sent: CommittedFileMutation[] = [];
  const publisher = createLibraryMutationPublisher({
    send: (value) => sent.push(value),
    now: () => now,
    setTimer: (callback) => { timerCallback = callback; return 1; },
    clearTimer: () => { timerCallback = null; },
  });

  publisher.publish(mutation());
  publisher.publish(mutation({ browseRevision: 2, paths: ['/models/b.stl'], affectedPaths: ['/models/b.stl'] }));
  publisher.flush();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].affectedPaths, ['/models/b.stl']);
  assert.equal(timerCallback, null);

  now = 1;
  publisher.publish(mutation({ browseRevision: 3 }));
  assert.equal(timerCallback !== null, true);
  publisher.dispose();
  assert.equal(timerCallback, null);
  assert.equal(sent.length, 2);
});

test('a delayed timer does not cause a second same-time publish when a new mutation arrives', () => {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, () => void>();
  const sent: CommittedFileMutation[] = [];
  const publisher = createLibraryMutationPublisher({
    send: (value) => sent.push(value),
    now: () => now,
    setTimer: (callback) => { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimer: (handle) => { timers.delete(handle as number); },
  });

  publisher.publish(mutation());
  publisher.publish(mutation({ paths: ['/models/b.stl'], affectedPaths: ['/models/b.stl'], browseRevision: 2 }));
  now = 250;
  publisher.publish(mutation({ paths: ['/models/c.stl'], affectedPaths: ['/models/c.stl'], browseRevision: 3 }));

  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].affectedPaths, ['/models/b.stl', '/models/c.stl']);
  assert.equal(timers.size, 0);
  publisher.dispose();
});
