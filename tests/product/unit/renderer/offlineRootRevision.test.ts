import test from "node:test";
import assert from "node:assert/strict";
import { advanceOfflineRootRevision, getOfflineRootRevision, canClearOfflineRootAfterScan } from "../../../../src/renderer/lib/offlineRootRevision";

test("a scan cannot clear offline status after a newer root availability transition", () => {
  const revisions = new Map<string, number>();
  const rootKey = "/models";
  const scanStartedAt = getOfflineRootRevision(revisions, rootKey);

  advanceOfflineRootRevision(revisions, rootKey); // root-unavailable event

  assert.equal(canClearOfflineRootAfterScan(scanStartedAt, getOfflineRootRevision(revisions, rootKey)), false);
});

test("completed or partial scan can clear status when no newer root event occurred", () => {
  const revisions = new Map<string, number>();
  const rootKey = "/models";
  advanceOfflineRootRevision(revisions, rootKey); // offline marker was recorded
  const scanStartedAt = getOfflineRootRevision(revisions, rootKey);

  assert.equal(canClearOfflineRootAfterScan(scanStartedAt, getOfflineRootRevision(revisions, rootKey)), true);
});
