import type { IpcMain } from 'electron';
import type {
  BackgroundJob,
  BackgroundJobCommandResult,
  BackgroundJobState,
  ScanJobs,
  ThumbnailJobControls,
} from '../shared/backgroundJobs';
import { IPC } from '../shared/types';

type ScanJobCommands = Pick<ScanJobs, 'pauseJob' | 'resumeJob' | 'cancelJob' | 'retryJobFailures'>;
type ThumbnailJobCommands = Pick<ThumbnailJobControls,
  'pauseThumbnailJob' | 'resumeThumbnailJob' | 'cancelThumbnailJob' | 'retryThumbnailJobFailures'>;

export interface BackgroundJobCommandDependencies {
  getJobs: () => Promise<BackgroundJob[]>;
  scanJobs: ScanJobCommands;
  thumbnailJobs: ThumbnailJobCommands;
}

export interface BackgroundJobCommandRouter {
  pause(jobId: unknown): Promise<BackgroundJobCommandResult>;
  resume(jobId: unknown): Promise<BackgroundJobCommandResult>;
  cancel(jobId: unknown): Promise<BackgroundJobCommandResult>;
  retryFailures(jobId: unknown): Promise<BackgroundJobCommandResult>;
}

type Command = keyof BackgroundJobCommandRouter;

function success(jobId: string, state: BackgroundJobState): BackgroundJobCommandResult {
  return { ok: true, jobId, state };
}

export function createBackgroundJobCommandRouter(
  dependencies: BackgroundJobCommandDependencies,
): BackgroundJobCommandRouter {
  async function execute(command: Command, rawJobId: unknown): Promise<BackgroundJobCommandResult> {
    if (typeof rawJobId !== 'string' || rawJobId.length === 0) return { ok: false, reason: 'not-found' };
    const jobId = rawJobId;
    const job = (await dependencies.getJobs()).find((candidate) => candidate.jobId === jobId);
    if (!job) return { ok: false, reason: 'not-found' };

    if (command === 'pause' && job.state === 'paused' ||
        command === 'resume' && job.state === 'running' ||
        command === 'cancel' && (job.state === 'cancelling' || job.state === 'cancelled')) {
      return success(jobId, job.state);
    }

    const allowed = command === 'pause' ? ['queued', 'running', 'pausing']
      : command === 'resume' ? ['paused']
        : command === 'cancel' ? ['queued', 'running', 'pausing', 'paused']
          : ['partial', 'failed'];
    if (!allowed.includes(job.state)) return { ok: false, reason: 'invalid-state' };
    if (command === 'retryFailures' && !job.errors.some((error) => error.retryable)) {
      return { ok: false, reason: 'no-retryable-failures' };
    }

    if (job.kind === 'scan') return dependencies.scanJobs[command === 'retryFailures' ? 'retryJobFailures'
      : command === 'pause' ? 'pauseJob' : command === 'resume' ? 'resumeJob' : 'cancelJob'](jobId);

    const thumbnailCommand = command === 'retryFailures' ? 'retryThumbnailJobFailures'
      : command === 'pause' ? 'pauseThumbnailJob'
        : command === 'resume' ? 'resumeThumbnailJob' : 'cancelThumbnailJob';
    await dependencies.thumbnailJobs[thumbnailCommand](jobId);
    const current = (await dependencies.getJobs()).find((candidate) => candidate.jobId === jobId);
    return success(jobId, current?.state ?? job.state);
  }

  return {
    pause: (jobId) => execute('pause', jobId),
    resume: (jobId) => execute('resume', jobId),
    cancel: (jobId) => execute('cancel', jobId),
    retryFailures: (jobId) => execute('retryFailures', jobId),
  };
}

export function registerBackgroundJobCommandHandlers(
  ipcMain: Pick<IpcMain, 'handle'>,
  dependencies: BackgroundJobCommandDependencies,
) {
  const router = createBackgroundJobCommandRouter(dependencies);
  ipcMain.handle(IPC.PAUSE_BACKGROUND_JOB, (_event, jobId: unknown) => router.pause(jobId));
  ipcMain.handle(IPC.RESUME_BACKGROUND_JOB, (_event, jobId: unknown) => router.resume(jobId));
  ipcMain.handle(IPC.CANCEL_BACKGROUND_JOB, (_event, jobId: unknown) => router.cancel(jobId));
  ipcMain.handle(IPC.RETRY_BACKGROUND_JOB_FAILURES, (_event, jobId: unknown) => router.retryFailures(jobId));
  return router;
}
