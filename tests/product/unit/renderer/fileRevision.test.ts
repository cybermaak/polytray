import test from 'node:test';
import assert from 'node:assert/strict';
import type { FileRecord } from '../../../../src/shared/types';
import type { PreviewTarget } from '../../../../src/shared/previewTarget';
import { patchPreviewTargetFile } from '../../../../src/renderer/lib/fileRevision';

const file = (overrides: Partial<FileRecord> = {}): FileRecord => ({
  id: 1, path: '/models/a.stl', name: 'a', extension: 'stl', directory: '/models',
  size_bytes: 10, modified_at: 1, content_revision: 2, archive_path: null,
  vertex_count: 3, face_count: 1, tags: null, notes: null, dimensions: null,
  thumbnail: null, thumbnail_failed: 0, indexed_at: 1, ...overrides,
});

test('older file updates cannot regress regular or archive preview targets', () => {
  const currentFile = file({ content_revision: 4, notes: 'current' });
  const staleFile = file({ content_revision: 3, notes: 'stale' });
  const fileTarget: PreviewTarget = { kind: 'file', file: currentFile };
  assert.equal(patchPreviewTargetFile(fileTarget, staleFile), fileTarget);

  const archiveTarget: PreviewTarget = {
    kind: 'archive',
    archive: {
      kind: 'archive', key: 'archive:/models/a.zip', archivePath: '/models/a.zip', name: 'a.zip',
      modelCount: 1, vertexCount: 3, faceCount: 1, sizeBytes: 10, thumbnailSamples: [currentFile],
    },
    query: {
      sort: 'name', direction: 'ASC', extension: null, folder: null, search: '',
      collectionPaths: null, limit: 24, offset: 0,
    },
  };
  assert.equal(patchPreviewTargetFile(archiveTarget, staleFile), archiveTarget);
  const newerFile = file({ content_revision: 5, notes: 'newer' });
  const updatedTarget = patchPreviewTargetFile(archiveTarget, newerFile);
  assert.notEqual(updatedTarget, archiveTarget);
  assert.equal(updatedTarget?.kind, 'archive');
  if (updatedTarget?.kind === 'archive') {
    assert.equal(updatedTarget.archive.thumbnailSamples[0].content_revision, 5);
    assert.equal(updatedTarget.archive.thumbnailSamples[0].notes, 'newer');
  }
});
