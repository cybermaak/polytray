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

test("post-outage request cannot clear status when it coalesced to a pre-outage job", () => {
  const revisions = new Map<string, number>();
  const rootKey = "/models";
  advanceOfflineRootRevision(revisions, rootKey); // root-unavailable event
  const scanRequestedAt = getOfflineRootRevision(revisions, rootKey);
  const unavailableAt = 100;
  const actualCoalescedJobStartedAt = 99;

  assert.equal(canClearOfflineRootAfterScan(scanRequestedAt, getOfflineRootRevision(revisions, rootKey), actualCoalescedJobStartedAt, unavailableAt), false);
});

test("post-outage job clears status only when its start is strictly newer than the outage", () => {
  const revisions = new Map<string, number>();
  const rootKey = "/models";
  advanceOfflineRootRevision(revisions, rootKey);
  const scanStartedAt = getOfflineRootRevision(revisions, rootKey);

  assert.equal(canClearOfflineRootAfterScan(scanStartedAt, scanStartedAt, 101, 100), true);
  assert.equal(canClearOfflineRootAfterScan(scanStartedAt, scanStartedAt, 100, 100), false);
});
