export function formatMetadataRestoreAcknowledgmentFailure(message: string, recoveryBackupPath: string): string {
  return `Metadata was committed, but local restore acknowledgment failed: ${message}. Recovery data is retained at ${recoveryBackupPath}. Restart the app to resume recovery.`;
}

export function formatMetadataRestoreCommitRecoveryFailure(message: string, recoveryBackupPath: string): string {
  return `Metadata reached SQLite, but the restore could not finish: ${message}. Recovery data is retained at ${recoveryBackupPath}. Restart the app to resume recovery.`;
}

export function formatMetadataImportCancelFailure(message: string, recoveryBackupPath?: string): string {
  if (recoveryBackupPath) {
    return `Import cancellation failed: ${message}. Committed recovery data remains at ${recoveryBackupPath}; restart the app to resume recovery.`;
  }
  return `Import preview could not be canceled: ${message}. The preview is still open and can be canceled again.`;
}

export function shouldCancelPreviewOnUnmount(transactionId: string | null, commitInProgress: boolean, committedTransactionId: string | null): boolean {
  return transactionId !== null && !commitInProgress && committedTransactionId !== transactionId;
}

export function isCommittedMetadataRestoreState(state: string): boolean {
  return state === "database-applied" || state === "renderer-applied" || state === "complete";
}
