import type { Dialog, IpcMain } from 'electron';
import type { Database } from 'better-sqlite3';
import type { MetadataBackupAnnotation } from '../../shared/metadataBackup';
import type { MetadataRestoreService } from '../../shared/backupContracts';
import { createMetadataBackupService } from '../metadataBackupService';

export const METADATA_BACKUP_EXPORT_CHANNEL = 'export-metadata-backup';
export const METADATA_RESTORE_CHANNELS = {
  snapshot: 'get-metadata-restore-snapshot',
  preview: 'preview-metadata-backup-import',
  commit: 'commit-metadata-backup-import',
  acknowledge: 'acknowledge-metadata-backup-import',
  cancel: 'cancel-metadata-backup-import',
  status: 'get-metadata-restore-status',
  retry: 'retry-pending-metadata-annotations',
} as const;

export interface MetadataBackupIpcDependencies {
  ipcMain: IpcMain;
  db: Database;
  dialog: Pick<Dialog, 'showSaveDialog'>;
  appVersion: string;
  getCurrentRendererRevision: () => number;
  getPendingAnnotations?: () => MetadataBackupAnnotation[];
}

export function registerMetadataBackupHandlers(dependencies: MetadataBackupIpcDependencies) {
  const service = createMetadataBackupService({
    db: dependencies.db,
    appVersion: dependencies.appVersion,
    getCurrentRendererRevision: dependencies.getCurrentRendererRevision,
    getPendingAnnotations: dependencies.getPendingAnnotations,
    showSaveDialog: () => dependencies.dialog.showSaveDialog({
      title: 'Export Polytray Metadata Backup',
      buttonLabel: 'Export',
      defaultPath: 'polytray-metadata-backup.json',
      filters: [{ name: 'Polytray Metadata Backup', extensions: ['json'] }],
    }),
  });

  dependencies.ipcMain.handle(METADATA_BACKUP_EXPORT_CHANNEL, async (_event, payload: unknown) => {
    // exportMetadata performs main-process runtime validation before I/O.
    return service.exportMetadata(payload);
  });
}

export interface MetadataRestoreIpcDependencies {
  ipcMain: IpcMain;
  service: MetadataRestoreService;
}

function recordPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid metadata restore request');
  return value as Record<string, unknown>;
}

/** Registration stays separate so the coordinator can wire it after startup recovery is ready. */
export function registerMetadataRestoreHandlers(dependencies: MetadataRestoreIpcDependencies) {
  const { ipcMain, service } = dependencies;
  ipcMain.handle(METADATA_RESTORE_CHANNELS.snapshot, async () => service.getCurrentSnapshot());
  ipcMain.handle(METADATA_RESTORE_CHANNELS.preview, async (_event, raw: unknown) => {
    try {
      const payload = recordPayload(raw);
      if (!('backup' in payload) || !payload.currentSnapshot || typeof payload.currentSnapshot !== 'object') throw new Error('Invalid metadata restore preview request');
      return { status: 'preview', plan: service.previewImport(payload.backup, payload.currentSnapshot as never,
        payload.options && typeof payload.options === 'object' ? payload.options as { replaceSettings?: boolean; replaceRoots?: boolean } : undefined) };
    } catch (error) { return { status: 'failed', message: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle(METADATA_RESTORE_CHANNELS.commit, async (_event, raw: unknown) => {
    try {
      const payload = recordPayload(raw);
      if (typeof payload.transactionId !== 'string') throw new Error('Invalid metadata restore transaction ID');
      return await service.commitImport(payload.transactionId);
    } catch (error) { return { status: 'failed', message: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle(METADATA_RESTORE_CHANNELS.acknowledge, async (_event, raw: unknown) => {
    try {
      const payload = recordPayload(raw);
      if (typeof payload.transactionId !== 'string' || !Number.isSafeInteger(payload.rendererRevision)) throw new Error('Invalid metadata restore acknowledgment');
      await service.acknowledgeImport(payload.transactionId, payload.rendererRevision as number);
      return { status: 'acknowledged' };
    } catch (error) { return { status: 'failed', message: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle(METADATA_RESTORE_CHANNELS.cancel, async (_event, raw: unknown) => {
    try {
      const payload = recordPayload(raw);
      if (typeof payload.transactionId !== 'string') throw new Error('Invalid metadata restore transaction ID');
      await service.cancelImport(payload.transactionId);
      return { status: 'cancelled' };
    } catch (error) { return { status: 'failed', message: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle(METADATA_RESTORE_CHANNELS.status, async () => service.getStatus());
  ipcMain.handle(METADATA_RESTORE_CHANNELS.retry, async () => service.retryPendingAnnotations());
  return () => { for (const channel of Object.values(METADATA_RESTORE_CHANNELS)) ipcMain.removeHandler(channel); };
}
