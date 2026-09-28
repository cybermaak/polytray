import test from "node:test";
import assert from "node:assert/strict";
import {
  getGridMoveIndex,
  getGridColumnCount,
  getGridActivationAction,
  getGridMoveDelta,
  getGridPageEdgeTarget,
  getGridTabStopKey,
  reconcileGridFocus,
  sameGridKeys,
} from "../../../../src/renderer/lib/gridNavigation";

test("grid movement uses rendered column count and never targets a negative item", () => {
  assert.equal(getGridMoveIndex(4, 10, 3, "ArrowDown"), 7);
  assert.equal(getGridMoveIndex(8, 10, 3, "ArrowDown"), 9);
  assert.equal(getGridMoveIndex(1, 10, 3, "ArrowLeft"), 0);
});

test("Home and End target the first and last loaded item", () => {
  assert.equal(getGridMoveIndex(4, 10, 4, "Home"), 0);
  assert.equal(getGridMoveIndex(4, 10, 4, "End"), 9);
});

test("page-edge movement preserves the requested column beyond the loaded range", () => {
  assert.equal(getGridMoveDelta("ArrowDown", 3), 3);
  assert.equal(getGridMoveDelta("PageDown", 3, 12), 12);
});

test("page-edge loading starts only when a vertical move leaves the loaded range", () => {
  assert.equal(getGridPageEdgeTarget(47, 50, 2, "ArrowDown", 8, true), null);
  assert.equal(getGridPageEdgeTarget(48, 50, 2, "ArrowDown", 8, true), 50);
  assert.equal(getGridPageEdgeTarget(49, 50, 2, "ArrowDown", 8, true), 51);
  assert.equal(getGridPageEdgeTarget(49, 50, 2, "ArrowDown", 8, false), null);
});

test("rendered CSS tracks determine the actual number of columns", () => {
  assert.equal(getGridColumnCount("220px 220px 220px"), 3);
  assert.equal(getGridColumnCount("minmax(0px, 1fr) minmax(0px, 1fr)"), 2);
});

test("refresh reconciliation preserves a stable key and falls back at the removed index", () => {
  assert.deepEqual(reconcileGridFocus(["a", "b", "c"], ["x", "b"], "b"), { key: "b", index: 1 });
  assert.deepEqual(reconcileGridFocus(["a", "b", "c"], ["a", "c"], "b"), { key: "c", index: 1 });
  assert.deepEqual(reconcileGridFocus(["a", "b"], [], "b"), { key: null, index: -1 });
});

test("metadata-only refreshes with the same stable keys do not invalidate grid focus", () => {
  assert.equal(sameGridKeys(["a", "b"], ["a", "b"]), true);
  assert.equal(sameGridKeys(["a", "b"], ["b", "a"]), false);
  assert.equal(sameGridKeys(["a"], []), false);
});

test("a virtualized roving key falls back to a rendered tab stop without replacing logical focus", () => {
  assert.equal(getGridTabStopKey("b", ["a", "b", "c"]), "b");
  assert.equal(getGridTabStopKey("a", ["b", "c"]), "b");
  assert.equal(getGridTabStopKey("a", []), null);
});

test("grid activation keeps preview keys and exposes a modifier selection path", () => {
  assert.equal(getGridActivationAction("Enter", false, false, true), "preview");
  assert.equal(getGridActivationAction(" ", false, false, true), "preview");
  assert.equal(getGridActivationAction("Enter", true, false, true), "toggle-selection");
  assert.equal(getGridActivationAction(" ", false, true, true), "toggle-selection");
  assert.equal(getGridActivationAction("Enter", true, false, false), "preview");
  assert.equal(getGridActivationAction(" ", false, true, false), "preview");
});
