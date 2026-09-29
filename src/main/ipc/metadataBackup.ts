import type { Dialog, IpcMain, IpcMainInvokeEvent } from 'electron';
import type { Database } from 'better-sqlite3';
import type { MetadataBackupAnnotation } from '../../shared/metadataBackup';
import type { MetadataBackupSnapshot, MetadataRestoreService, StagedMetadataRestore } from '../../shared/backupContracts';
import { METADATA_RESTORE_IPC } from '../../shared/types';
import { createMetadataBackupService } from '../metadataBackupService';

export const METADATA_BACKUP_EXPORT_CHANNEL = 'export-metadata-backup';
export const METADATA_RESTORE_CHANNELS = {
  snapshot: METADATA_RESTORE_IPC.snapshot,
  preview: METADATA_RESTORE_IPC.preview,
  commit: METADATA_RESTORE_IPC.commit,
  acknowledge: METADATA_RESTORE_IPC.acknowledge,
  cancel: METADATA_RESTORE_IPC.cancel,
  status: METADATA_RESTORE_IPC.status,
  retry: METADATA_RESTORE_IPC.retry,
  publishSnapshot: METADATA_RESTORE_IPC.publishSnapshot,
  bootstrap: METADATA_RESTORE_IPC.bootstrap,
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
  updateRendererSnapshot?: (snapshot: MetadataBackupSnapshot & { preferences: Record<string, unknown> }) => void;
  startAfterRecovery?: () => Promise<void>;
  applyRendererState?: (state: StagedMetadataRestore) => Promise<void>;
  runMutation?: <T>(operation: () => T | Promise<T>) => Promise<T>;
  authorizeRenderer?: (event: IpcMainInvokeEvent) => void;
  holdRendererStateOnBlocked?: () => Promise<void>;
  prepareRecoveryRetry?: () => Promise<void>;
}

function recordPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid metadata restore request');
  return value as Record<string, unknown>;
}

/** Registration stays separate so the coordinator can wire it after startup recovery is ready. */
export function registerMetadataRestoreHandlers(dependencies: MetadataRestoreIpcDependencies) {
  const { ipcMain, service } = dependencies;
  let startupRecoveryReady = false;
  const ensureStartupRecoveryReady = () => {
    if (!startupRecoveryReady) throw new Error('Startup metadata recovery must finish before restore writes can run');
  };
  const handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, async (event, ...args) => {
      dependencies.authorizeRenderer?.(event);
      return listener(event, ...args);
    });
  };
  const updateSnapshot = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid metadata restore snapshot');
    const snapshot = value as MetadataBackupSnapshot & { preferences: Record<string, unknown> };
    if (!Number.isSafeInteger(snapshot.rendererRevision) || snapshot.rendererRevision < 0 ||
        !Array.isArray(snapshot.libraryRoots) || !Array.isArray(snapshot.collections) ||
        !snapshot.preferences || typeof snapshot.preferences !== 'object' || Array.isArray(snapshot.preferences)) {
      throw new Error('Invalid metadata restore snapshot');
    }
    dependencies.updateRendererSnapshot?.(snapshot);
  };
  handle(METADATA_RESTORE_CHANNELS.snapshot, async (_event, raw: unknown) => {
    if (raw !== undefined) updateSnapshot(raw);
    return service.getCurrentSnapshot();
  });
  handle(METADATA_RESTORE_CHANNELS.publishSnapshot, async (_event, raw: unknown) => {
    updateSnapshot(raw);
    return { status: 'published' };
  });
  handle(METADATA_RESTORE_CHANNELS.bootstrap, async (_event, raw: unknown) => {
    updateSnapshot(raw);
    await dependencies.prepareRecoveryRetry?.();
    const recovery = await service.reconcileImport();
    if (recovery.status === 'blocked') await dependencies.holdRendererStateOnBlocked?.();
    else {
      await dependencies.startAfterRecovery?.();
      startupRecoveryReady = true;
    }
    return recovery;
  });
  handle(METADATA_RESTORE_CHANNELS.preview, async (_event, raw: unknown) => {
    try {
      const payload = recordPayload(raw);
      if (!('backup' in payload) || !payload.currentSnapshot || typeof payload.currentSnapshot !== 'object') throw new Error('Invalid metadata restore preview request');
      return { status: 'preview', plan: service.previewImport(payload.backup, payload.currentSnapshot as never,
        payload.options && typeof payload.options === 'object' ? payload.options as { replaceSettings?: boolean; replaceRoots?: boolean } : undefined) };
    } catch (error) { return { status: 'failed', message: error instanceof Error ? error.message : String(error) }; }
  });
  handle(METADATA_RESTORE_CHANNELS.commit, async (_event, raw: unknown) => {
    try {
      const payload = recordPayload(raw);
      if (typeof payload.transactionId !== 'string') throw new Error('Invalid metadata restore transaction ID');
      ensureStartupRecoveryReady();
      return await service.commitImport(payload.transactionId);
    } catch (error) { return { status: 'failed', message: error instanceof Error ? error.message : String(error) }; }
  });
  handle(METADATA_RESTORE_CHANNELS.acknowledge, async (_event, raw: unknown) => {
    try {
      const payload = recordPayload(raw);
      if (typeof payload.transactionId !== 'string' || !Number.isSafeInteger(payload.rendererRevision)) throw new Error('Invalid metadata restore acknowledgment');
      ensureStartupRecoveryReady();
      await service.acknowledgeImport(payload.transactionId, payload.rendererRevision as number);
      return { status: 'acknowledged' };
    } catch (error) { return { status: 'failed', message: error instanceof Error ? error.message : String(error) }; }
  });
  handle(METADATA_RESTORE_CHANNELS.cancel, async (_event, raw: unknown) => {
    try {
      const payload = recordPayload(raw);
      if (typeof payload.transactionId !== 'string') throw new Error('Invalid metadata restore transaction ID');
      ensureStartupRecoveryReady();
      await service.cancelImport(payload.transactionId);
      return { status: 'cancelled' };
    } catch (error) { return { status: 'failed', message: error instanceof Error ? error.message : String(error) }; }
  });
  handle(METADATA_RESTORE_CHANNELS.status, async () => service.getStatus());
  handle(METADATA_RESTORE_CHANNELS.retry, async () => {
    ensureStartupRecoveryReady();
    return dependencies.runMutation
      ? dependencies.runMutation(() => service.retryPendingAnnotations())
      : service.retryPendingAnnotations();
  });
  handle(METADATA_RESTORE_IPC.applyRequest, async (_event, raw: unknown) => {
    ensureStartupRecoveryReady();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !dependencies.applyRendererState) throw new Error('Invalid metadata restore state');
    await dependencies.applyRendererState(raw as StagedMetadataRestore);
    return { status: 'applied' };
  });
  return () => {
    for (const channel of [...Object.values(METADATA_RESTORE_CHANNELS), METADATA_RESTORE_IPC.applyRequest]) ipcMain.removeHandler(channel);
  };
}
