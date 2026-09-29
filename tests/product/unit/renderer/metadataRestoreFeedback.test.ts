import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMetadataImportCancelFailure, formatMetadataRestoreAcknowledgmentFailure, isCommittedMetadataRestoreState, shouldCancelPreviewOnUnmount } from '../../../../src/renderer/lib/metadataRestoreFeedback';

test('failed metadata restore acknowledgment remains actionable and never says stores are synchronized', () => {
  const message = formatMetadataRestoreAcknowledgmentFailure('renderer revision mismatch', '/isolated/user-data/metadata-restore/backups/import.json');
  assert.match(message, /renderer revision mismatch/);
  assert.match(message, /Recovery data is retained at \/isolated\/user-data\/metadata-restore\/backups\/import\.json/);
  assert.match(message, /Restart the app to resume recovery/);
  assert.doesNotMatch(message, /in sync|synchronized/i);
});

test('preview cleanup cancels only uncommitted previews and reports cancellation failures truthfully', () => {
  assert.equal(shouldCancelPreviewOnUnmount('preview-1', false, null), true);
  assert.equal(shouldCancelPreviewOnUnmount('preview-1', true, null), false);
  assert.equal(shouldCancelPreviewOnUnmount('preview-1', false, 'preview-1'), false);
  assert.equal(isCommittedMetadataRestoreState('prepared'), false);
  assert.equal(isCommittedMetadataRestoreState('database-applied'), true);
  assert.equal(isCommittedMetadataRestoreState('renderer-applied'), true);
  assert.equal(isCommittedMetadataRestoreState('complete'), true);
  assert.match(formatMetadataImportCancelFailure('disk journal is unavailable'), /preview is still open/);
  assert.match(formatMetadataImportCancelFailure('already committed', '/user-data/metadata-restore/backup.json'), /recovery data remains at \/user-data\/metadata-restore\/backup\.json/);
});
