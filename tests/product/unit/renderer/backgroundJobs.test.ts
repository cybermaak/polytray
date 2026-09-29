import test from "node:test";
import assert from "node:assert/strict";
import { backgroundJobsReducer, createBackgroundJobsState } from "../../../../src/renderer/hooks/useBackgroundJobs";
import { getDiscoveryProgressPresentation } from "../../../../src/renderer/components/ScanProgress";
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

test("terminal history is capped without evicting long-paused active jobs", () => {
  let state = createBackgroundJobsState();
  state = backgroundJobsReducer(state, { type: "job", job: job("long-paused", 1, "paused") });
  const terminalJobs = Array.from({ length: 25 }, (_, index) => job(`terminal-${index}`, index + 2, "completed"));
  state = backgroundJobsReducer(state, { type: "snapshot", jobs: terminalJobs });
  assert.equal(state.jobs.filter((item) => ["queued", "running", "pausing", "paused", "cancelling"].includes(item.state)).length, 1);
  assert.ok(state.jobs.some((item) => item.jobId === "long-paused" && item.state === "paused"));
  assert.equal(state.jobs.filter((item) => item.state === "completed").length, 20);
  assert.ok(state.jobs.some((item) => item.jobId === "long-paused"));
});

test("discovery progress is indeterminate only while discovery is active", () => {
  const running = getDiscoveryProgressPresentation(job("scan-running", 1, "running"));
  assert.equal(running.mode, "indeterminate");
  assert.equal(running.ariaValueText, "1 files discovered; total is still unknown");
  const paused = getDiscoveryProgressPresentation(job("scan-paused", 2, "paused"));
  assert.equal(paused.mode, "indeterminate");
  assert.match(paused.summary, /paused/);

  for (const state of ["completed", "partial", "failed", "cancelled"] as const) {
    const terminal = getDiscoveryProgressPresentation(job(`scan-${state}`, 2, state));
    assert.equal(terminal.mode, "terminal");
    assert.equal(terminal.showProgressBar, false);
    assert.match(terminal.summary, /found/);
  }
});
