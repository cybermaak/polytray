import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_COLLECTIONS_STATE,
  normalizeCollectionsState,
  serializeCollectionsState,
  upsertCollection,
  removeCollection,
  addFilesToCollection,
} from "../../../../src/shared/libraryCollections";

test("normalizeCollectionsState dedupes file paths and drops invalid active ids", () => {
  const state = normalizeCollectionsState({
    activeCollectionId: "missing",
    collections: [
      {
        id: "desk",
        name: "Desk",
        filePaths: ["/a.stl", "/a.stl", "  ", "/b.obj"],
      },
    ],
  });

  assert.deepEqual(state.collections[0].filePaths, ["/a.stl", "/b.obj"]);
  assert.equal(state.activeCollectionId, null);
});

test("collection helpers create, update, and remove virtual collections predictably", () => {
  let state = upsertCollection(DEFAULT_COLLECTIONS_STATE, {
    id: "desk",
    name: "Desk Prints",
    filePaths: ["/a.stl"],
  });
  state = addFilesToCollection(state, "desk", ["/b.obj", "/a.stl"]);

  assert.deepEqual(state.collections[0].filePaths, ["/a.stl", "/b.obj"]);

  state = removeCollection(state, "desk");
  assert.deepEqual(state, DEFAULT_COLLECTIONS_STATE);
});

test("serializeCollectionsState writes a normalized localStorage payload", () => {
  const payload = serializeCollectionsState({
    collections: [{ id: "desk", name: "Desk", filePaths: ["/a.stl", "/a.stl"] }],
    activeCollectionId: "desk",
  });

  const parsed = JSON.parse(payload) as {
    collections: Array<{ id: string; name: string; filePaths: string[] }>;
    activeCollectionId: string | null;
  };

  assert.deepEqual(parsed.collections[0].filePaths, ["/a.stl"]);
  assert.equal(parsed.activeCollectionId, "desk");
});
