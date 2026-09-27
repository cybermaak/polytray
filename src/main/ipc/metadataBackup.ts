import type { Dialog, IpcMain } from 'electron';
import type { Database } from 'better-sqlite3';
import type { MetadataBackupAnnotation } from '../../shared/metadataBackup';
import { parseMetadataBackupSnapshot } from '../../shared/metadataBackup';
import { createMetadataBackupService } from '../metadataBackupService';

export const METADATA_BACKUP_EXPORT_CHANNEL = 'export-metadata-backup';

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
    let snapshot;
    try {
      snapshot = parseMetadataBackupSnapshot(payload);
    } catch (error) {
      return {
        status: 'failed' as const,
        code: 'invalid-snapshot' as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return service.exportMetadata(snapshot);
  });
}
