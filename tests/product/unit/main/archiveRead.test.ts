import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { openArchiveNoFollow } from '../../../../src/main/archiveRead';

test('archive reader uses an opened regular source and closes it after member extraction', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-archive-read-'));
  try {
    const source = path.join(root, 'models.zip');
    const zip = new JSZip();
    zip.file('parts/model.3mf', 'selected model');
    fs.writeFileSync(source, await zip.generateAsync({ type: 'nodebuffer' }));
    const opened = await openArchiveNoFollow(source);
    try {
      const entry = opened.files.find(item => item.path === 'parts/model.3mf');
      assert.ok(entry);
      assert.equal((await entry.buffer()).toString(), 'selected model');
    } finally {
      await opened.close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('archive reader refuses a final symlink source', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-archive-read-'));
  try {
    const outside = path.join(root, 'outside.zip');
    fs.writeFileSync(outside, 'private');
    const source = path.join(root, 'indexed.zip');
    fs.symlinkSync(outside, source);
    await assert.rejects(openArchiveNoFollow(source));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('archive reader keeps every byte when positional reads return short chunks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-archive-read-'));
  try {
    const source = path.join(root, 'models.zip');
    const zip = new JSZip();
    zip.file('parts/model.3mf', 'selected model with short reads');
    fs.writeFileSync(source, await zip.generateAsync({ type: 'nodebuffer' }));
    const handle = await fs.promises.open(source, 'r');
    let reads = 0;
    const opened = await openArchiveNoFollow(source, async () => ({
      stat: () => handle.stat(),
      read: (buffer, offset, length, position) => {
        reads++;
        return handle.read(buffer, offset, Math.min(length, 7), position);
      },
      close: () => handle.close(),
    }));
    try {
      const entry = opened.files.find(item => item.path === 'parts/model.3mf');
      assert.ok(entry);
      assert.equal((await entry.buffer()).toString(), 'selected model with short reads');
      assert.ok(reads > 1);
    } finally {
      await opened.close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('closing an archive waits for an in-flight range read after entry cancellation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-archive-read-'));
  let releaseRead = () => {};
  try {
    const source = path.join(root, 'models.zip');
    const zip = new JSZip();
    zip.file('parts/model.3mf', Buffer.alloc(2 * 1024 * 1024, 3), { compression: 'STORE' });
    fs.writeFileSync(source, await zip.generateAsync({ type: 'nodebuffer' }));
    const handle = await fs.promises.open(source, 'r');
    let holdMemberReads = false;
    let closed = false;
    let markReadStarted = () => {};
    const readStarted = new Promise<void>(resolve => { markReadStarted = resolve; });
    const release = new Promise<void>(resolve => { releaseRead = resolve; });
    const opened = await openArchiveNoFollow(source, async () => ({
      stat: () => handle.stat(),
      read: async (buffer, offset, length, position) => {
        if (holdMemberReads) {
          markReadStarted();
          await release;
          if (closed) throw new Error('read after descriptor close');
        }
        return handle.read(buffer, offset, length, position);
      },
      close: async () => { closed = true; await handle.close(); },
    }));
    const entry = opened.files.find(item => item.path === 'parts/model.3mf');
    assert.ok(entry);
    holdMemberReads = true;
    const stream = entry.stream();
    stream.on('error', () => {});
    stream.resume();
    await readStarted;
    stream.destroy();
    const closing = opened.close();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(closed, false);
    releaseRead();
    await closing;
    assert.equal(closed, true);
  } finally {
    releaseRead();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('truncated archive member rejects instead of leaving its read pending', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-archive-read-'));
  try {
    const source = path.join(root, 'models.zip');
    const zip = new JSZip();
    zip.file('parts/model.3mf', Buffer.alloc(2 * 1024 * 1024, 3), { compression: 'STORE' });
    fs.writeFileSync(source, await zip.generateAsync({ type: 'nodebuffer' }));
    const opened = await openArchiveNoFollow(source);
    try {
      fs.truncateSync(source, 0);
      const entry = opened.files.find(item => item.path === 'parts/model.3mf');
      assert.ok(entry);
      const result = await Promise.race([
        entry.buffer().then(() => 'resolved', error => `rejected: ${String(error)}`),
        new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 400)),
      ]);
      assert.match(result, /^rejected:/);
    } finally {
      await opened.close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
