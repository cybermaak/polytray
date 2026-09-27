import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import JSZip from 'jszip';
import * as unzipper from 'unzipper';
import { decidePruneCandidates, matchesScanSnapshot } from '../../../../src/main/scanCoverage';
import { discoverFolder } from '../../../../src/main/scanner';

const root = path.resolve('/tmp/polytray-library');
const complete = (scopePath: string, kind: 'directory' | 'archive' = 'directory') => ({ scopePath, kind, status: 'complete' as const });
const failed = (scopePath: string, kind: 'directory' | 'archive' = 'directory') => ({ scopePath, kind, status: 'error' as const, phase: 'readdir', reason: 'unavailable' });

test('unavailable root retains every starting row', () => {
  const result = decidePruneCandidates({ rootPath: root, state: 'partial', scopes: [failed(root)], discoveredPaths: [], candidates: [{ id: 1, path: path.join(root, 'tagged.stl'), generation: 4 }] });
  assert.deepEqual(result.prune, []);
  assert.equal(result.retained, 1);
});

test('failed child retains its subtree while a complete sibling can prune', () => {
  const child = path.join(root, 'blocked');
  const result = decidePruneCandidates({ rootPath: root, state: 'partial', scopes: [complete(root), failed(child)], discoveredPaths: [], candidates: [{ id: 1, path: path.join(child, 'note.obj'), generation: 4 }, { id: 2, path: path.join(root, 'removed.stl'), generation: 4 }] });
  assert.deepEqual(result.prune.map((row) => row.id), [2]);
  assert.equal(result.retained, 1);
});

test('successful empty scope prunes old rows, but failed archive preserves virtual members', () => {
  const archive = path.join(root, 'broken.zip');
  const result = decidePruneCandidates({ rootPath: root, state: 'partial', scopes: [complete(root), failed(archive, 'archive')], discoveredPaths: [], candidates: [{ id: 1, path: path.join(root, 'empty', 'old.stl'), generation: 4 }, { id: 2, path: `${archive}::entry::inside.stl`, generation: 4 }] });
  assert.deepEqual(result.prune.map((row) => row.id), [1]);
  assert.equal(result.retained, 1);
});

test('cancellation prevents all pruning and non-starting generations are retained', () => {
  const result = decidePruneCandidates({ rootPath: root, state: 'cancelled', scopes: [complete(root)], discoveredPaths: [], candidates: [{ id: 1, path: path.join(root, 'gone.stl'), generation: 4 }, { id: 2, path: path.join(root, 'new.stl'), generation: 5 }] });
  assert.deepEqual(result.prune, []);
  assert.equal(result.retained, 2);
});

test('contained path matching does not confuse sibling prefixes', () => {
  const result = decidePruneCandidates({ rootPath: root, state: 'completed', scopes: [complete(root)], discoveredPaths: [], candidates: [{ id: 1, path: `${root}-backup/file.stl`, generation: 4 }] });
  assert.deepEqual(result.prune, []);
  assert.equal(result.retained, 1);
});

test('scan deletion snapshot changes when annotations are edited during discovery', () => {
  const snapshot = { id: 12, path: path.join(root, 'model.stl'), indexed_at: 5, modified_at: 4, size_bytes: 10, tags: '["old"]', notes: 'before', print_status: 'unprinted', content_revision: 2, scan_generation: 7 };
  assert.equal(matchesScanSnapshot(snapshot, { ...snapshot }), true);
  assert.equal(matchesScanSnapshot(snapshot, { ...snapshot, notes: 'edited during scan' }), false);
  assert.equal(matchesScanSnapshot(snapshot, { ...snapshot, tags: '["new"]' }), false);
  assert.equal(matchesScanSnapshot(snapshot, { ...snapshot, print_status: 'printed' }), false);
  assert.equal(matchesScanSnapshot(snapshot, { ...snapshot, id: 13 }), false);
});

test('same-timestamp file revisions and scan generations invalidate an older prune snapshot', () => {
  const snapshot = {
    id: 12, path: path.join(root, 'model.stl'), indexed_at: 5, modified_at: 4, size_bytes: 10,
    tags: null, notes: null, print_status: 'Not Printed', content_revision: 3, scan_generation: 8,
  };
  assert.equal(matchesScanSnapshot(snapshot, { ...snapshot }), true);
  assert.equal(matchesScanSnapshot(snapshot, { ...snapshot, content_revision: 4 }), false);
  assert.equal(matchesScanSnapshot(snapshot, { ...snapshot, scan_generation: 9 }), false);
});

test('successful empty directory is complete while a corrupt existing ZIP is an error', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-coverage-'));
  try {
    const empty = path.join(temp, 'empty');
    fs.mkdirSync(empty);
    const emptyResult = await discoverFolder(empty);
    assert.equal(emptyResult.state, 'completed');
    assert.equal(emptyResult.scopes.some((scope) => scope.scopePath === empty && scope.status === 'complete'), true);

    const brokenZip = path.join(temp, 'broken.zip');
    fs.writeFileSync(brokenZip, 'not a zip');
    const archiveResult = await discoverFolder(temp);
    assert.equal(archiveResult.state, 'partial');
    assert.equal(archiveResult.scopes.some((scope) => scope.scopePath === brokenZip && scope.kind === 'archive' && scope.status === 'error'), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('pre-cancelled discovery reports cancellation and no complete namespace', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-cancel-'));
  const controller = new AbortController();
  controller.abort();
  try {
    const result = await discoverFolder(temp, controller.signal);
    assert.equal(result.state, 'cancelled');
    assert.deepEqual(result.scopes, []);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('unreadable child is reported while its readable parent remains complete', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-child-error-'));
  const child = path.join(temp, 'blocked');
  fs.mkdirSync(child);
  const originalReaddir = fs.promises.readdir;
  try {
    fs.promises.readdir = (async (target: fs.PathLike, ...args: unknown[]) => {
      if (String(target) === child) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return (originalReaddir as (...values: unknown[]) => Promise<fs.Dirent[]>)(target, ...args);
    }) as typeof fs.promises.readdir;
    const result = await discoverFolder(temp);
    assert.equal(result.state, 'partial');
    assert.equal(result.scopes.some((scope) => scope.scopePath === child && scope.status === 'error'), true);
    assert.equal(result.scopes.some((scope) => scope.scopePath === temp && scope.status === 'complete'), true);
  } finally {
    fs.promises.readdir = originalReaddir;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('cancellation midway through directory discovery leaves the namespace incomplete', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-mid-cancel-'));
  fs.writeFileSync(path.join(temp, 'one.stl'), 'solid one');
  const controller = new AbortController();
  const originalReaddir = fs.promises.readdir;
  let release!: () => void;
  let entered!: () => void;
  const didEnter = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    fs.promises.readdir = (async (target: fs.PathLike, ...args: unknown[]) => {
      const result = await (originalReaddir as (...values: unknown[]) => Promise<fs.Dirent[]>)(target, ...args);
      if (String(target) === temp) { entered(); await gate; }
      return result;
    }) as typeof fs.promises.readdir;
    const pending = discoverFolder(temp, controller.signal);
    await didEnter;
    controller.abort();
    release();
    const result = await pending;
    assert.equal(result.state, 'cancelled');
    assert.equal(result.files.length, 0);
    assert.equal(result.scopes.some((scope) => scope.scopePath === temp && scope.status === 'complete'), false);
  } finally {
    fs.promises.readdir = originalReaddir;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('cancellation during the final empty child listing cannot complete that scope', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-final-child-'));
  const child = path.join(temp, 'empty');
  fs.mkdirSync(child);
  const controller = new AbortController();
  const originalReaddir = fs.promises.readdir;
  let release!: () => void;
  let entered!: () => void;
  const didEnter = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    fs.promises.readdir = (async (target: fs.PathLike, ...args: unknown[]) => {
      const result = await (originalReaddir as (...values: unknown[]) => Promise<fs.Dirent[]>)(target, ...args);
      if (String(target) === child) { entered(); await gate; }
      return result;
    }) as typeof fs.promises.readdir;
    const pending = discoverFolder(temp, controller.signal);
    await didEnter;
    controller.abort();
    release();
    const result = await pending;
    assert.equal(result.state, 'cancelled');
    assert.equal(result.scopes.some((scope) => scope.scopePath === child && scope.status === 'complete'), false);
  } finally {
    fs.promises.readdir = originalReaddir;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('cancellation while opening an empty archive cannot complete the archive scope', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-final-zip-'));
  const archive = path.join(temp, 'empty.zip');
  fs.writeFileSync(archive, await new JSZip().generateAsync({ type: 'nodebuffer' }));
  const controller = new AbortController();
  const originalOpen = unzipper.Open.file;
  let release!: () => void;
  let entered!: () => void;
  const didEnter = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    unzipper.Open.file = (async (target: string) => {
      const result = await originalOpen(target);
      if (target === archive) { entered(); await gate; }
      return result;
    }) as typeof unzipper.Open.file;
    const pending = discoverFolder(temp, controller.signal);
    await didEnter;
    controller.abort();
    release();
    const result = await pending;
    assert.equal(result.state, 'cancelled');
    assert.equal(result.scopes.some((scope) => scope.scopePath === archive && scope.status === 'complete'), false);
  } finally {
    unzipper.Open.file = originalOpen;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('cancellation during a model stat cannot publish the file or complete its parent', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-stat-cancel-'));
  const file = path.join(temp, 'model.stl');
  fs.writeFileSync(file, 'solid model');
  const controller = new AbortController();
  const originalStat = fs.promises.stat;
  let release!: () => void;
  let entered!: () => void;
  const didEnter = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    fs.promises.stat = (async (target: fs.PathLike, ...args: unknown[]) => {
      if (String(target) === file) { entered(); await gate; }
      return (originalStat as (...values: unknown[]) => Promise<fs.Stats>)(target, ...args);
    }) as typeof fs.promises.stat;
    const pending = discoverFolder(temp, controller.signal);
    await didEnter;
    controller.abort();
    release();
    const result = await pending;
    assert.equal(result.state, 'cancelled');
    assert.deepEqual(result.files, []);
    assert.equal(result.scopes.some((scope) => scope.scopePath === temp && scope.status === 'complete'), false);
  } finally {
    fs.promises.stat = originalStat;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('stat failure is incomplete coverage and cannot prune the affected file', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-stat-error-'));
  const file = path.join(temp, 'lost.stl');
  fs.writeFileSync(file, 'solid lost');
  const originalStat = fs.promises.stat;
  try {
    fs.promises.stat = (async (target: fs.PathLike, ...args: unknown[]) => {
      if (String(target) === file) throw Object.assign(new Error('gone during scan'), { code: 'ENOENT' });
      return (originalStat as (...values: unknown[]) => Promise<fs.Stats>)(target, ...args);
    }) as typeof fs.promises.stat;
    const result = await discoverFolder(temp);
    assert.equal(result.state, 'partial');
    assert.equal(result.scopes.some((scope) => scope.scopePath === file && scope.phase === 'stat' && scope.status === 'error'), true);
    const prune = decidePruneCandidates({ rootPath: temp, state: result.state, scopes: result.scopes, discoveredPaths: [], candidates: [{ id: 7, path: file, generation: 1 }] });
    assert.deepEqual(prune.prune, []);
  } finally {
    fs.promises.stat = originalStat;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('complete parent coverage prunes confirmed removed child-directory and ZIP members', () => {
  const child = path.join(root, 'removed-child');
  const archive = path.join(root, 'removed.zip');
  const result = decidePruneCandidates({ rootPath: root, state: 'completed', scopes: [complete(root)], discoveredPaths: [], candidates: [
    { id: 1, path: path.join(child, 'old.stl'), generation: 1 },
    { id: 2, path: `${archive}::entry::old.obj`, generation: 1 },
  ] });
  assert.deepEqual(result.prune.map((row) => row.id), [1, 2]);
});

test('excluded fixture subtree blocks pruning under its unenumerated namespace', () => {
  const excluded = path.join(root, 'tests', 'fixtures');
  const result = decidePruneCandidates({ rootPath: root, state: 'partial', scopes: [complete(root), { scopePath: excluded, kind: 'directory', status: 'excluded' }], discoveredPaths: [], candidates: [{ id: 1, path: path.join(excluded, 'legacy.stl'), generation: 1 }] });
  assert.deepEqual(result.prune, []);
});

test('scanner reports its tests/fixtures exclusion as partial and preserves old indexed rows there', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-exclusion-'));
  const testRoot = path.join(temp, 'tests');
  const excluded = path.join(testRoot, 'fixtures');
  fs.mkdirSync(excluded, { recursive: true });
  fs.writeFileSync(path.join(excluded, 'not-enumerated.stl'), 'solid fixture');
  try {
    const discovery = await discoverFolder(testRoot);
    assert.equal(discovery.state, 'partial');
    assert.equal(discovery.files.length, 0);
    assert.equal(discovery.scopes.some((scope) => scope.scopePath === excluded && scope.status === 'excluded'), true);
    const result = decidePruneCandidates({ rootPath: testRoot, state: discovery.state, scopes: discovery.scopes, discoveredPaths: [], candidates: [{ id: 1, path: path.join(excluded, 'old-indexed.stl'), generation: 1 }] });
    assert.deepEqual(result.prune, []);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
