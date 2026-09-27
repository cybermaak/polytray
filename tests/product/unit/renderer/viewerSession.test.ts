import assert from "node:assert/strict";
import test from "node:test";
import { createMainWindowVisibilityGate, disposeOwnedViewerResources, ViewerSession } from "../../../../src/renderer/lib/viewerSession";

function createFrameHarness() {
  let nextId = 1;
  const frames = new Map<number, FrameRequestCallback>();
  return {
    requestFrame(callback: FrameRequestCallback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id: number) { frames.delete(id); },
    get pendingCount() { return frames.size; },
    takeNext() {
      const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) return null;
      frames.delete(entry[0]);
      return entry[1];
    },
    runNext() {
      const callback = this.takeNext();
      if (!callback) return false;
      callback(0);
      return true;
    },
  };
}

test("viewer session coalesces invalidation and stops scheduling after controls settle", () => {
  const frames = createFrameHarness();
  let updates = 0;
  let draws = 0;
  const session = new ViewerSession({}, {
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    updateControls: () => updates++ === 0,
    draw: () => { draws++; },
  });

  session.invalidate();
  session.invalidate();
  assert.equal(frames.pendingCount, 1);
  frames.runNext();
  assert.equal(draws, 1);
  assert.equal(frames.pendingCount, 1);
  frames.runNext();
  assert.equal(draws, 2);
  assert.equal(frames.pendingCount, 0);
});

test("hidden and disposed sessions do not schedule frames or run stale load tokens", async () => {
  const frames = createFrameHarness();
  let draws = 0;
  let cleanupCount = 0;
  const session = new ViewerSession({}, {
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    updateControls: () => false,
    draw: () => { draws++; },
  });
  const token = session.beginLoad();
  session.setVisible(false);
  session.invalidate();
  assert.equal(frames.pendingCount, 0);
  session.setVisible(true);
  assert.equal(frames.pendingCount, 1);
  const staleCallback = frames.takeNext();
  assert.ok(staleCallback);
  session.invalidate();
  const deferredFrame = session.yieldToFrame();
  session.addCleanup(() => { cleanupCount++; });
  session.dispose();
  session.dispose();
  assert.equal(frames.pendingCount, 0);
  assert.equal(frames.runNext(), false);
  await deferredFrame;
  staleCallback(0);
  assert.equal(draws, 0);
  assert.equal(cleanupCount, 1);
  assert.equal(session.isCurrent(token), false);
});

test("disposing an old session tears down only its own resources", () => {
  const frames = createFrameHarness();
  const disposedResources: string[] = [];
  const disposalOrder: string[] = [];
  let activeSession: ViewerSession<{ id: string }> | null = null;
  const createSession = (id: string) => new ViewerSession(
    { id },
    {
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
      updateControls: () => false,
      draw: () => {},
    },
    (resources, owner) => disposeOwnedViewerResources(
      owner,
      activeSession,
      resources,
      (owned, ownsCurrentUi) => {
        disposedResources.push(owned.id);
        disposalOrder.push(`${owned.id}-resources`);
        if (ownsCurrentUi) activeSession = null;
      },
      () => { activeSession = null; },
    ),
  );

  const oldSession = createSession("old");
  activeSession = oldSession;
  oldSession.addCleanup(() => { disposalOrder.push("old-listeners"); });
  const replacement = createSession("replacement");
  activeSession = replacement;

  oldSession.dispose();
  assert.equal(activeSession, replacement);
  assert.deepEqual(disposedResources, ["old"]);
  assert.deepEqual(disposalOrder, ["old-listeners", "old-resources"]);
  oldSession.dispose();
  assert.deepEqual(disposedResources, ["old"]);
  replacement.dispose();
  assert.equal(activeSession, null);
  assert.deepEqual(disposedResources, ["old", "replacement"]);
});

test("stale initial visibility replies cannot override newer native events", () => {
  const states: boolean[] = [];
  const acceptVisibility = createMainWindowVisibilityGate((visible) => states.push(visible));

  assert.equal(acceptVisibility({ revision: 1, visible: true }), true);
  assert.equal(acceptVisibility({ revision: 2, visible: false }), true);
  assert.equal(acceptVisibility({ revision: 1, visible: true }), false);
  assert.deepEqual(states, [true, false]);
});
