export function formatMetadataRestoreAcknowledgmentFailure(message: string, recoveryBackupPath: string): string {
  return `Metadata was committed, but local restore acknowledgment failed: ${message}. Recovery data is retained at ${recoveryBackupPath}. Restart the app to resume recovery.`;
}
