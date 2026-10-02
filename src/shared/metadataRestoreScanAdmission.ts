import type { BackgroundJob } from './backgroundJobs';

export const SCAN_BLOCKS_METADATA_IMPORT_MESSAGE = 'Finish or cancel active scans before applying this import.';
const ACTIVE_SCAN_STATES = new Set<BackgroundJob['state']>(['queued', 'running', 'pausing', 'paused', 'cancelling']);

export function hasActiveScanWork(jobs: readonly BackgroundJob[], pending: ReadonlySet<string> = new Set()) {
  return jobs.some(job => job.kind === 'scan' && (ACTIVE_SCAN_STATES.has(job.state) || pending.has(job.jobId)));
}
