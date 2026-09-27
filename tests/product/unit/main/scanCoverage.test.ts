import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
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
  const snapshot = { id: 12, path: path.join(root, 'model.stl'), indexed_at: 5, modified_at: 4, size_bytes: 10, tags: '["old"]', notes: 'before', print_status: 'unprinted' };
  assert.equal(matchesScanSnapshot(snapshot, { ...snapshot }), true);
  assert.equal(matchesScanSnapshot(snapshot, { ...snapshot, notes: 'edited during scan' }), false);
  assert.equal(matchesScanSnapshot(snapshot, { ...snapshot, tags: '["new"]' }), false);
  assert.equal(matchesScanSnapshot(snapshot, { ...snapshot, print_status: 'printed' }), false);
  assert.equal(matchesScanSnapshot(snapshot, { ...snapshot, id: 13 }), false);
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
