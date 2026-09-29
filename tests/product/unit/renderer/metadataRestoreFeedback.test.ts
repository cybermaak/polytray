import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMetadataRestoreAcknowledgmentFailure } from '../../../../src/renderer/lib/metadataRestoreFeedback';

test('failed metadata restore acknowledgment remains actionable and never says stores are synchronized', () => {
  const message = formatMetadataRestoreAcknowledgmentFailure('renderer revision mismatch', '/isolated/user-data/metadata-restore/backups/import.json');
  assert.match(message, /renderer revision mismatch/);
  assert.match(message, /Recovery data is retained at \/isolated\/user-data\/metadata-restore\/backups\/import\.json/);
  assert.match(message, /Restart the app to resume recovery/);
  assert.doesNotMatch(message, /in sync|synchronized/i);
});
