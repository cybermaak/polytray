import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { PassThrough } from 'node:stream';
import { createArchiveEntryPath } from '../../../../src/shared/archivePaths';
import { readIndexedPreviewArchiveBuffer, validateIndexedPreviewRequest } from '../../../../src/main/previewParseService';
import type { PreviewParseRequest } from '../../../../src/shared/previewContracts';

function createDatabase(archivePath: string, entryPath: string) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE files(path TEXT PRIMARY KEY, extension TEXT NOT NULL, content_revision INTEGER NOT NULL, archive_path TEXT);');
  db.prepare('INSERT INTO files(path, extension, content_revision, archive_path) VALUES(?,?,?,?)')
    .run(createArchiveEntryPath(archivePath, entryPath), '3mf', 12, archivePath);
  return db;
}

function makeRequest(archivePath: string, entryPath = 'parts/model.3mf', contentRevision = 12): PreviewParseRequest {
  return { requestId: 'request-1', path: createArchiveEntryPath(archivePath, entryPath), extension: '3mf', contentRevision };
}

test('archive source read uses the exact indexed member and validates content revision', async () => {
  const archivePath = path.join('/tmp', 'preview-read.zip');
  const exactMember = 'a/../parts/model.3mf';
  const zip = new JSZip();
  zip.file(exactMember, 'exact member bytes');
  zip.file('parts/model.3mf', 'different member bytes');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const temp = path.join('/tmp', `preview-read-${process.pid}.zip`);
  const fs = await import('node:fs/promises');
  await fs.writeFile(temp, bytes);
  const db = createDatabase(temp, exactMember);
  try {
    const request = makeRequest(temp, exactMember);
    validateIndexedPreviewRequest(db, request);
    const buffer = await readIndexedPreviewArchiveBuffer(db, request, new AbortController().signal);
    assert.equal(Buffer.from(buffer).toString('utf8'), 'exact member bytes');
    assert.throws(() => validateIndexedPreviewRequest(db, { ...request, contentRevision: 11 }), /stale/i);
  } finally {
    db.close();
    await fs.rm(temp, { force: true });
  }
});

test('main archive stream stops on cancellation and rejects an unindexed member', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-preview-read-'));
  const archivePath = path.join(tempDir, 'unused-preview.zip');
  fs.writeFileSync(archivePath, 'test stream source');
  const entryPath = 'parts/model.3mf';
  const db = createDatabase(archivePath, entryPath);
  const streamCreated = (() => {
    let resolve!: (stream: PassThrough) => void;
    const promise = new Promise<PassThrough>((done) => { resolve = done; });
    return { promise, resolve };
  })();
  try {
    const request = makeRequest(archivePath, entryPath);
    const controller = new AbortController();
    const pending = readIndexedPreviewArchiveBuffer(db, request, controller.signal, async () => ({
      files: [{ path: entryPath, type: 'File', stream: () => {
        const stream = new PassThrough();
        streamCreated.resolve(stream);
        return stream;
      } }],
    }));
    const stream = await streamCreated.promise;
    controller.abort();
    await assert.rejects(pending, /aborted/i);
    assert.equal(stream.destroyed, true);
    assert.throws(() => validateIndexedPreviewRequest(db, makeRequest(archivePath, 'missing.3mf')), /not indexed/i);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('main archive read rejects an indexed archive replaced by a symlink', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-preview-read-'));
  const archivePath = path.join(tempDir, 'indexed.zip');
  const outside = path.join(tempDir, 'outside.zip');
  fs.writeFileSync(outside, 'private');
  fs.symlinkSync(outside, archivePath);
  const db = createDatabase(archivePath, 'parts/model.3mf');
  try {
    await assert.rejects(
      readIndexedPreviewArchiveBuffer(db, makeRequest(archivePath), new AbortController().signal),
      /regular file/i,
    );
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
