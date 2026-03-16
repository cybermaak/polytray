import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeFileTags,
  serializeFileTags,
  parseStoredFileTags,
} from "../../../../src/shared/fileTags";

test("normalizeFileTags trims, dedupes, and drops empties", () => {
  assert.deepEqual(
    normalizeFileTags(["  vase  ", "", "Print", "vase", "PRINT", " tray "]),
    ["vase", "Print", "tray"],
  );
});

test("serializeFileTags and parseStoredFileTags round-trip normalized tag lists", () => {
  const serialized = serializeFileTags(["  desk  ", "organizer", "desk"]);
  assert.equal(serialized, JSON.stringify(["desk", "organizer"]));
  assert.deepEqual(parseStoredFileTags(serialized), ["desk", "organizer"]);
  assert.deepEqual(parseStoredFileTags(null), []);
});
