import test from "node:test";
import assert from "node:assert/strict";
import { backgroundJobsReducer, createBackgroundJobsState } from "../../../../src/renderer/hooks/useBackgroundJobs";
import type { BackgroundJob } from "../../../../src/shared/backgroundJobs";

function job(jobId: string, updatedAt: number, state: BackgroundJob["state"] = "running"): BackgroundJob {
  return {
    jobId, kind: "scan", rootPath: "/models", scopePath: "/models", state,
    counts: { discovered: 1, indexed: 1, indexFailed: 0, metadataCompleted: 0, metadataFailed: 0, thumbnailsSucceeded: 0, thumbnailsFailed: 0, thumbnailsPending: 0 },
    errors: [], startedAt: 1, updatedAt,
  };
}

test("newer events win over a late initial job snapshot", () => {
  let state = createBackgroundJobsState();
  state = backgroundJobsReducer(state, { type: "job", job: job("scan-a", 20, "completed") });
  state = backgroundJobsReducer(state, { type: "snapshot", jobs: [job("scan-a", 10)] });
  assert.equal(state.jobs[0].state, "completed");
  assert.equal(state.jobs[0].updatedAt, 20);
});

test("adjacent jobs remain independently visible and dismiss by identity", () => {
  let state = createBackgroundJobsState();
  state = backgroundJobsReducer(state, { type: "job", job: job("scan-old", 20, "completed") });
  state = backgroundJobsReducer(state, { type: "job", job: job("scan-new", 21, "running") });
  state = backgroundJobsReducer(state, { type: "dismiss", jobId: "scan-old" });
  assert.deepEqual(state.jobs.map(({ jobId }) => jobId), ["scan-new"]);
});

test("terminal state is retained until the same job is explicitly dismissed", () => {
  let state = createBackgroundJobsState();
  state = backgroundJobsReducer(state, { type: "job", job: job("scan-a", 2, "partial") });
  assert.equal(state.jobs[0].state, "partial");
  state = backgroundJobsReducer(state, { type: "dismiss", jobId: "scan-a" });
  assert.equal(state.jobs.length, 0);
  state = backgroundJobsReducer(state, { type: "job", job: job("scan-a", 3, "completed") });
  state = backgroundJobsReducer(state, { type: "snapshot", jobs: [job("scan-a", 4, "completed")] });
  assert.equal(state.jobs.length, 0);
});
