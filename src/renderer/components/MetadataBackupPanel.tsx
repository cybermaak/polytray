import React from "react";
import type { MetadataBackupSnapshot, MetadataImportPlan, MetadataRestoreStatus, StagedMetadataRestore } from "../../shared/backupContracts";
import type { MetadataRestoreAcknowledgeResult } from "../../shared/backupContracts";
import { subscribeToRestoreStatusRefresh } from "../lib/restoreStatusSubscription";
import { formatMetadataRestoreAcknowledgmentFailure } from "../lib/metadataRestoreFeedback";

interface Props {
  getSnapshot: () => MetadataBackupSnapshot & { preferences: Record<string, unknown> };
  disabled?: boolean;
  onRecoveryError: (message: string | null) => void;
}

export const MetadataBackupPanel: React.FC<Props> = ({ getSnapshot, disabled = false, onRecoveryError }) => {
  const [plan, setPlan] = React.useState<MetadataImportPlan | null>(null);
  const [replaceSettings, setReplaceSettings] = React.useState(false);
  const [replaceRoots, setReplaceRoots] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<MetadataRestoreStatus | null>(null);
  const [recoveryBackupPath, setRecoveryBackupPath] = React.useState<string | null>(null);
  const [recoveryError, setRecoveryError] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const refreshStatus = React.useCallback(async () => {
    try {
      const next = await window.polytray.getMetadataRestoreStatus();
      setStatus(next);
      const latestBackup = next.transactions.at(-1)?.recoveryBackupPath;
      if (latestBackup) setRecoveryBackupPath(latestBackup);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }, []);
  React.useEffect(() => { void refreshStatus(); }, [refreshStatus]);
  React.useEffect(() => subscribeToRestoreStatusRefresh(window.polytray.onLibraryChanged, refreshStatus), [refreshStatus]);

  const exportBackup = async () => {
    setBusy(true); setMessage("");
    try {
      const current = await window.polytray.getMetadataRestoreSnapshot(getSnapshot());
      const result = await window.polytray.exportMetadataBackup(current);
      if (result.status === "exported") setMessage(`Metadata backup saved to ${result.location}. Source model files are not included.`);
      else if (result.status === "cancelled") setMessage("Export cancelled; no file was written.");
      else setMessage(result.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const previewFile = async (file?: File) => {
    setPlan(null);
    if (!file) { setMessage("Import cancelled; nothing changed."); return; }
    setBusy(true); setMessage("");
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error("Backup exceeds the 50 MiB import limit.");
      const backup: unknown = JSON.parse(await file.text());
      const currentSnapshot = await window.polytray.getMetadataRestoreSnapshot(getSnapshot());
      const result = await window.polytray.previewMetadataRestore({ backup, currentSnapshot, options: { replaceSettings, replaceRoots } });
      if (result.status === "failed") throw new Error(result.message);
      setPlan(result.plan);
      setMessage("Review this plan. Your library changes only after you choose Apply import.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const applyImport = async () => {
    if (!plan) return;
    setBusy(true); setMessage("Applying metadata and local settings…");
    let committedState: StagedMetadataRestore | null = null;
    try {
      const result = await window.polytray.commitMetadataRestore(plan.transactionId);
      if (result.status === "failed") throw new Error(result.message);
      if (result.status === "cancelled") { setMessage("Import cancelled; nothing changed."); setPlan(null); return; }
      committedState = result.rendererState;
      setRecoveryBackupPath(committedState.recoveryBackupPath);
      await window.polytray.applyMetadataRestoreState(result.rendererState);
      const acknowledgment: MetadataRestoreAcknowledgeResult = await window.polytray.acknowledgeMetadataRestore(plan.transactionId, result.rendererState.rendererRevision);
      if (acknowledgment.status === "failed") {
        const recoveryMessage = formatMetadataRestoreAcknowledgmentFailure(acknowledgment.message, committedState.recoveryBackupPath);
        setRecoveryError(recoveryMessage);
        setMessage(recoveryMessage);
        onRecoveryError(recoveryMessage);
        await refreshStatus();
        return;
      }
      setRecoveryError(null);
      onRecoveryError(null);
      setPlan(null);
      await refreshStatus();
      setMessage("Metadata import applied. The library and local settings are in sync.");
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      if (committedState) {
        const recoveryMessage = formatMetadataRestoreAcknowledgmentFailure(errorText, committedState.recoveryBackupPath);
        setRecoveryError(recoveryMessage);
        setMessage(recoveryMessage);
        onRecoveryError(recoveryMessage);
        await refreshStatus();
      } else setMessage(errorText);
    }
    finally { setBusy(false); }
  };

  const retryPending = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await window.polytray.retryPendingMetadataAnnotations();
      setMessage(`Matched ${result.appliedCount} pending annotation${result.appliedCount === 1 ? "" : "s"}; ${result.conflictCount} conflict${result.conflictCount === 1 ? "" : "s"} preserved.`);
      await refreshStatus();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return <section className="settings-group" aria-labelledby="metadata-backup-title">
    <div className="settings-group-title" id="metadata-backup-title">Metadata backup</div>
    <p className="settings-row-desc">This portable backup contains annotations, collections, library roots, and selected preferences. Source model files are not included.</p>
    <div className="settings-row">
      <button type="button" id="export-metadata-backup" disabled={disabled || busy} onClick={() => void exportBackup()}>Export metadata…</button>
      <button type="button" id="choose-metadata-backup" disabled={disabled || busy} onClick={() => fileInput.current?.click()}>Preview import…</button>
      <input ref={fileInput} id="metadata-backup-file" type="file" accept="application/json,.json" hidden onChange={event => {
        const file = event.currentTarget.files?.[0];
        void previewFile(file);
        event.currentTarget.value = "";
      }} />
    </div>
    <label className="settings-row"><span>Replace portable preferences</span><input type="checkbox" id="restore-replace-settings" checked={replaceSettings} disabled={disabled || busy || !!plan} onChange={event => setReplaceSettings(event.currentTarget.checked)} /></label>
    <label className="settings-row"><span>Replace library roots</span><input type="checkbox" id="restore-replace-roots" checked={replaceRoots} disabled={disabled || busy || !!plan} onChange={event => setReplaceRoots(event.currentTarget.checked)} /></label>
    {plan && <div className="metadata-restore-preview" role="region" aria-label="Import preview">
      <h3>Review import</h3>
      <dl>
        <div><dt>Matched annotations</dt><dd>{plan.matchedAnnotationCount}</dd></div>
        <div><dt>Changed annotations</dt><dd>{plan.changedAnnotationCount}</dd></div>
        <div><dt>Pending annotations</dt><dd>{plan.pendingAnnotationCount}</dd></div>
        <div><dt>Unmatched paths</dt><dd>{plan.unmatchedPaths.length}</dd></div>
        <div><dt>Conflicts preserved</dt><dd>{plan.conflictCount}</dd></div>
        <div><dt>Collections after merge</dt><dd>{plan.collectionsAfter.length}</dd></div>
        <div><dt>Settings replacement</dt><dd>{plan.replaceSettings ? "Included" : "Not selected"}</dd></div>
        <div><dt>Library root replacement</dt><dd>{plan.replaceRoots ? "Included" : "Not selected"}</dd></div>
      </dl>
      {plan.unmatchedPaths.length > 0 && <details><summary>Unmatched paths</summary><ul>{plan.unmatchedPaths.map(path => <li key={path}>{path}</li>)}</ul></details>}
      <div className="settings-row">
        <button type="button" id="apply-metadata-import" disabled={disabled || busy} onClick={() => void applyImport()}>Apply import</button>
        <button type="button" id="cancel-metadata-import" disabled={busy} onClick={() => {
          const transactionId = plan.transactionId;
          setPlan(null);
          setMessage("Import cancelled; nothing changed.");
          void window.polytray.cancelMetadataRestore(transactionId).catch(error => setMessage(error instanceof Error ? error.message : String(error)));
        }}>Cancel</button>
      </div>
    </div>}
    {status?.error && <p role="alert">Metadata restore needs attention. Recovery data is retained. {status.error}</p>}
    {recoveryError && <p role="alert">{recoveryError}</p>}
    {status && <p role="status">{status.pendingAnnotationCount} annotations waiting for matching files.</p>}
    {recoveryBackupPath && <p className="settings-row-desc">Recovery backup: <code>{recoveryBackupPath}</code>
      <button type="button" id="copy-recovery-backup-location" onClick={() => void navigator.clipboard.writeText(recoveryBackupPath)}>Copy location</button>
    </p>}
    {status && status.pendingAnnotationCount > 0 && <button type="button" id="retry-pending-annotations" disabled={disabled || busy} onClick={() => void retryPending()}>Retry matching indexed files</button>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </section>;
};
