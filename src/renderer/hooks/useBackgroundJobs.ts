import { useCallback, useEffect, useReducer } from "react";
import type { BackgroundJob, BackgroundJobCommandResult } from "../../shared/backgroundJobs";

export interface BackgroundJobsState {
  jobs: BackgroundJob[];
  pending: string[];
  commandErrors: Record<string, string>;
  dismissed: string[];
}

export type BackgroundJobsAction =
  | { type: "snapshot"; jobs: BackgroundJob[] }
  | { type: "job"; job: BackgroundJob }
  | { type: "command-start"; jobId: string }
  | { type: "command-end"; jobId: string; error?: string }
  | { type: "dismiss"; jobId: string };

export function createBackgroundJobsState(): BackgroundJobsState {
  return { jobs: [], pending: [], commandErrors: {}, dismissed: [] };
}

function mergeJobs(current: BackgroundJob[], incoming: BackgroundJob[], replaceEqual = true) {
  const byId = new Map(current.map((job) => [job.jobId, job]));
  for (const job of incoming) {
    const previous = byId.get(job.jobId);
    if (!previous || job.updatedAt > previous.updatedAt || (replaceEqual && job.updatedAt === previous.updatedAt)) byId.set(job.jobId, job);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
}

export function backgroundJobsReducer(state: BackgroundJobsState, action: BackgroundJobsAction): BackgroundJobsState {
  switch (action.type) {
    case "snapshot": return { ...state, jobs: mergeJobs(state.jobs, action.jobs.filter((job) => !state.dismissed.includes(job.jobId)), false) };
    case "job": return state.dismissed.includes(action.job.jobId) ? state : { ...state, jobs: mergeJobs(state.jobs, [action.job]) };
    case "command-start": return {
      ...state,
      pending: state.pending.includes(action.jobId) ? state.pending : [...state.pending, action.jobId],
      commandErrors: Object.fromEntries(Object.entries(state.commandErrors).filter(([id]) => id !== action.jobId)),
    };
    case "command-end": {
      const commandErrors = { ...state.commandErrors };
      if (action.error) commandErrors[action.jobId] = action.error;
      else delete commandErrors[action.jobId];
      return { ...state, pending: state.pending.filter((id) => id !== action.jobId), commandErrors };
    }
    case "dismiss": return {
      ...state,
      jobs: state.jobs.filter((job) => job.jobId !== action.jobId),
      commandErrors: Object.fromEntries(Object.entries(state.commandErrors).filter(([id]) => id !== action.jobId)),
      dismissed: state.dismissed.includes(action.jobId) ? state.dismissed : [...state.dismissed, action.jobId],
    };
  }
}

function explainCommandResult(result: BackgroundJobCommandResult) {
  if (result.ok) return undefined;
  switch (result.reason) {
    case "not-found": return "This job is no longer available. Refreshing job status…";
    case "invalid-state": return "That action is no longer available for this job. Refreshing job status…";
    case "no-retryable-failures": return "There are no retryable failures in this job.";
  }
}

export function useBackgroundJobs() {
  const [state, dispatch] = useReducer(backgroundJobsReducer, undefined, createBackgroundJobsState);

  const refresh = useCallback(() => {
    void window.polytray.getBackgroundJobs().then((jobs) => {
      dispatch({ type: "snapshot", jobs });
    }).catch((error: unknown) => {
      console.warn("Could not load background job status", error);
    });
  }, []);

  useEffect(() => {
    const unsubscribe = window.polytray.onBackgroundJobChanged((job) => dispatch({ type: "job", job }));
    let active = true;
    void window.polytray.getBackgroundJobs().then((jobs) => {
      if (active) dispatch({ type: "snapshot", jobs });
    }).catch((error: unknown) => console.warn("Could not load background job status", error));
    return () => { active = false; unsubscribe(); };
  }, []);

  const command = useCallback(async (
    jobId: string,
    invoke: (id: string) => Promise<BackgroundJobCommandResult>,
  ) => {
    dispatch({ type: "command-start", jobId });
    try {
      const result = await invoke(jobId);
      dispatch({ type: "command-end", jobId, error: explainCommandResult(result) });
      if (!result.ok) refresh();
    } catch (error) {
      dispatch({ type: "command-end", jobId, error: error instanceof Error ? error.message : "The request failed." });
    }
  }, [refresh]);

  return {
    jobs: state.jobs,
    pending: new Set(state.pending),
    commandErrors: state.commandErrors,
    dismiss: (jobId: string) => dispatch({ type: "dismiss", jobId }),
    pause: (jobId: string) => void command(jobId, window.polytray.pauseBackgroundJob),
    resume: (jobId: string) => void command(jobId, window.polytray.resumeBackgroundJob),
    cancel: (jobId: string) => void command(jobId, window.polytray.cancelBackgroundJob),
    retry: (jobId: string) => void command(jobId, window.polytray.retryBackgroundJobFailures),
  };
}
