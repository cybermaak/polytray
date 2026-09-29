import React from "react";
import type { BackgroundJob } from "../../shared/backgroundJobs";

interface Props {
  visible: boolean;
  percent: number;
  text: string;
  count: string;
  jobs?: BackgroundJob[];
  pendingJobs?: ReadonlySet<string>;
  commandErrors?: Record<string, string>;
  onPause?: (jobId: string) => void;
  onResume?: (jobId: string) => void;
  onCancel?: (jobId: string) => void;
  onRetry?: (jobId: string) => void;
  onDismiss?: (jobId: string) => void;
}

const ACTIVE_STATES = new Set<BackgroundJob["state"]>(["queued", "running", "pausing", "paused", "cancelling"]);

function stateLabel(state: BackgroundJob["state"]) {
  return ({ queued: "Queued", running: "In progress", pausing: "Pausing…", paused: "Paused", cancelling: "Cancelling…", cancelled: "Cancelled", completed: "Complete", partial: "Partially complete", failed: "Failed" })[state];
}

function hasFailures(job: BackgroundJob) {
  return (job.state === "partial" || job.state === "failed")
    && job.errors.some((error) => error.retryable);
}

function JobCard({ job, pending, commandError, onPause, onResume, onCancel, onRetry, onDismiss }: {
  job: BackgroundJob;
  pending: boolean;
  commandError?: string;
  onPause?: Props["onPause"];
  onResume?: Props["onResume"];
  onCancel?: Props["onCancel"];
  onRetry?: Props["onRetry"];
  onDismiss?: Props["onDismiss"];
}) {
  const isActive = ACTIVE_STATES.has(job.state);
  const label = job.kind === "scan" ? "Library scan" : "Thumbnail generation";
  const titlePath = job.scopePath || job.rootPath || "Library";
  return (
    <article className="background-job" data-job-id={job.jobId} data-job-state={job.state} aria-label={`${label}: ${stateLabel(job.state)}`}>
      <div className="background-job-heading">
        <div><strong>{label}</strong><span className={`background-job-state state-${job.state}`}>{stateLabel(job.state)}</span></div>
        <span className="background-job-path" title={titlePath}>{titlePath}</span>
      </div>
      {job.kind === "scan" && <>
        <div className="background-job-progress" role="progressbar" aria-label="Discovery progress" aria-valuetext={`${job.counts.discovered} files discovered; total is still unknown`}><span /></div>
        <p>Discovery {job.state === "completed" || job.state === "partial" || job.state === "failed" || job.state === "cancelled" ? "finished" : "in progress"} · {job.counts.discovered} found</p>
        <p>{job.counts.indexed} indexed · {job.counts.indexFailed} index failures</p>
        <p>{job.counts.metadataCompleted} metadata read · {job.counts.metadataFailed} metadata failures</p>
      </>}
      <p>{job.counts.thumbnailsSucceeded} thumbnails generated · {job.counts.thumbnailsFailed} failed · {job.counts.thumbnailsPending} pending</p>
      {commandError && <p className="background-job-error" role="alert">{commandError}</p>}
      {job.errors.length > 0 && <details className="background-job-errors">
        <summary>{job.errors.length} {job.errors.length === 1 ? "issue" : "issues"} · {job.errors.some((error) => error.retryable) ? "some can be retried" : "no retry available"}</summary>
        <ul>{job.errors.slice(0, 20).map((error, index) => <li key={`${error.path}-${error.phase}-${error.code}-${index}`}>
          <strong>{error.phase}:</strong> {error.message}{error.path ? ` (${error.path})` : ""}{error.retryable ? " · retryable" : ""}
        </li>)}</ul>
      </details>}
      <div className="background-job-actions">
        {(job.state === "queued" || job.state === "running") && <button type="button" disabled={pending} onClick={() => onPause?.(job.jobId)}>Pause</button>}
        {job.state === "paused" && <button type="button" disabled={pending} onClick={() => onResume?.(job.jobId)}>Resume</button>}
        {isActive && <button type="button" disabled={pending || job.state === "cancelling"} onClick={() => onCancel?.(job.jobId)}>Cancel</button>}
        {hasFailures(job) && <button type="button" disabled={pending} onClick={() => onRetry?.(job.jobId)}>Retry failed items</button>}
        {!isActive && <button type="button" disabled={pending} onClick={() => onDismiss?.(job.jobId)}>Dismiss</button>}
        {pending && <span aria-live="polite">Updating…</span>}
      </div>
    </article>
  );
}

export const ScanProgress: React.FC<Props> = ({ visible, percent, text, count, jobs = [], pendingJobs = new Set(), commandErrors = {}, onPause, onResume, onCancel, onRetry, onDismiss }) => (
  <div id="scan-progress" className={`scan-progress${visible ? "" : " hidden"}`}>
    {jobs.length > 0 ? <details className="background-work-details" open={jobs.some((job) => ACTIVE_STATES.has(job.state))}>
      <summary>Background work · {jobs.length} {jobs.length === 1 ? "job" : "jobs"}</summary>
      <div className="background-jobs" aria-label="Background work">
        {jobs.map((job) => <JobCard key={job.jobId} job={job} pending={pendingJobs.has(job.jobId)} commandError={commandErrors[job.jobId]} onPause={onPause} onResume={onResume} onCancel={onCancel} onRetry={onRetry} onDismiss={onDismiss} />)}
      </div>
    </details> : <>
      <div className="progress-bar"><div className="progress-fill" id="progress-fill" style={{ width: `${percent}%` }} /></div>
      <div className="progress-text"><span id="progress-text">{text}</span><span id="progress-count">{count}</span></div>
    </>}
  </div>
);
