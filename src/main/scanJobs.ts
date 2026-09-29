import type { BackgroundJob, BackgroundJobCommandResult } from '../shared/backgroundJobs';

export interface ScanJobAdapter {
  getJobs(): BackgroundJob[];
  onChanged(callback: (job: BackgroundJob) => void): () => void;
  pause(jobId: string): Promise<boolean>;
  resume(jobId: string): Promise<boolean>;
  cancel(jobId: string): Promise<boolean>;
  retryFailures(jobId: string): Promise<boolean>;
}

/** Adapts scan-specific controls to the shared background-job contract. */
export class ScanJobsController {
  constructor(private readonly adapter: ScanJobAdapter) {}

  getBackgroundJobs() { return Promise.resolve(this.adapter.getJobs()); }
  onBackgroundJobChanged(callback: (job: BackgroundJob) => void) { return this.adapter.onChanged(callback); }

  pauseJob(jobId: string) { return this.command(jobId, 'pause'); }
  resumeJob(jobId: string) { return this.command(jobId, 'resume'); }
  cancelJob(jobId: string) { return this.command(jobId, 'cancel'); }
  retryJobFailures(jobId: string) { return this.command(jobId, 'retryFailures'); }

  private async command(jobId: string, action: 'pause' | 'resume' | 'cancel' | 'retryFailures'): Promise<BackgroundJobCommandResult> {
    const job = this.adapter.getJobs().find((candidate) => candidate.jobId === jobId);
    if (!job) return { ok: false, reason: 'not-found' };
    if (action === 'pause' && job.state === 'paused') return { ok: true, jobId, state: job.state };
    if (action === 'resume' && job.state === 'running') return { ok: true, jobId, state: job.state };
    if (action === 'cancel' && (job.state === 'cancelling' || job.state === 'cancelled')) {
      return { ok: true, jobId, state: job.state };
    }
    const allowed = action === 'pause' ? ['queued', 'running', 'pausing']
      : action === 'resume' ? ['paused']
        : action === 'cancel' ? ['queued', 'running', 'pausing', 'paused']
          : ['partial', 'failed'];
    if (!allowed.includes(job.state)) return { ok: false, reason: 'invalid-state' };
    if (!await this.adapter[action](jobId)) return { ok: false, reason: action === 'retryFailures' ? 'no-retryable-failures' : 'invalid-state' };
    const next = this.adapter.getJobs().find((candidate) => candidate.jobId === jobId);
    return { ok: true, jobId, state: next?.state ?? job.state };
  }
}
