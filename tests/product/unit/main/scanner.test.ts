import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DiscoveryEvent } from '../../../../src/shared/backgroundJobs';
import { streamDiscoverFolder } from '../../../../src/main/scanner';

test('isolated scanner hold blocks a configured second subtree until its release marker appears', { timeout: 5_000 }, async () => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-test-hold-'));
  const firstDirectory = path.join(rootPath, 'a-first');
  const delayedDirectory = path.join(rootPath, 'z-delayed');
  fs.mkdirSync(firstDirectory);
  fs.mkdirSync(delayedDirectory);
  fs.writeFileSync(path.join(firstDirectory, 'first.stl'), 'solid first\nendsolid first\n');
  fs.writeFileSync(path.join(delayedDirectory, 'later.stl'), 'solid later\nendsolid later\n');
  const releasePath = path.join(rootPath, 'release');
  const reachedPath = path.join(rootPath, 'reached');
  const oldEnv = {
    isolated: process.env.POLYTRAY_ISOLATED_TEST,
    scratch: process.env.POLYTRAY_PERF_SCRATCH,
    hold: process.env.POLYTRAY_SCAN_TEST_HOLD_PATH,
    release: process.env.POLYTRAY_SCAN_TEST_RELEASE_PATH,
    reached: process.env.POLYTRAY_SCAN_TEST_REACHED_PATH,
  };
  process.env.POLYTRAY_ISOLATED_TEST = '1';
  process.env.POLYTRAY_PERF_SCRATCH = rootPath;
  process.env.POLYTRAY_SCAN_TEST_HOLD_PATH = delayedDirectory;
  process.env.POLYTRAY_SCAN_TEST_RELEASE_PATH = releasePath;
  process.env.POLYTRAY_SCAN_TEST_REACHED_PATH = reachedPath;
  const events: DiscoveryEvent[] = [];
  const discovery = (async () => {
    for await (const event of streamDiscoverFolder(rootPath)) events.push(event);
  })();
  const reachedDeadline = Date.now() + 5_000;
  let stopMarkerPolling = false;
  const waitForReachedMarker = async () => {
    while (!stopMarkerPolling && !fs.existsSync(reachedPath)) {
      if (Date.now() >= reachedDeadline) throw new Error('Timed out waiting for the scanner hold marker');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  try {
    await Promise.race([
      waitForReachedMarker(),
      discovery.then(() => { throw new Error('Discovery completed without entering the configured hold'); }),
    ]);
    assert.equal(fs.existsSync(reachedPath), true);
    assert.equal(events.some((event) => event.type === 'file' && event.file.path === path.join(firstDirectory, 'first.stl')), true);
    assert.equal(events.some((event) => event.type === 'scope-complete' && event.scopePath === firstDirectory), true);
    assert.equal(events.some((event) => event.type === 'file' && event.file.path === path.join(delayedDirectory, 'later.stl')), false);
    assert.equal(events.some((event) => event.type === 'discovery-complete'), false);
  } finally {
    fs.writeFileSync(releasePath, 'release');
    stopMarkerPolling = true;
    await discovery;
    if (oldEnv.isolated === undefined) delete process.env.POLYTRAY_ISOLATED_TEST; else process.env.POLYTRAY_ISOLATED_TEST = oldEnv.isolated;
    if (oldEnv.scratch === undefined) delete process.env.POLYTRAY_PERF_SCRATCH; else process.env.POLYTRAY_PERF_SCRATCH = oldEnv.scratch;
    if (oldEnv.hold === undefined) delete process.env.POLYTRAY_SCAN_TEST_HOLD_PATH; else process.env.POLYTRAY_SCAN_TEST_HOLD_PATH = oldEnv.hold;
    if (oldEnv.release === undefined) delete process.env.POLYTRAY_SCAN_TEST_RELEASE_PATH; else process.env.POLYTRAY_SCAN_TEST_RELEASE_PATH = oldEnv.release;
    if (oldEnv.reached === undefined) delete process.env.POLYTRAY_SCAN_TEST_REACHED_PATH; else process.env.POLYTRAY_SCAN_TEST_REACHED_PATH = oldEnv.reached;
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test('scanner hold environment is ignored outside isolated-test mode', async () => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'polytray-scan-hold-disabled-'));
  const target = path.join(rootPath, 'target');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'model.stl'), 'solid model\nendsolid model\n');
  const releasePath = path.join(rootPath, 'unused-release');
  const reachedPath = path.join(rootPath, 'unused-reached');
  const oldEnv = {
    isolated: process.env.POLYTRAY_ISOLATED_TEST,
    hold: process.env.POLYTRAY_SCAN_TEST_HOLD_PATH,
    release: process.env.POLYTRAY_SCAN_TEST_RELEASE_PATH,
    reached: process.env.POLYTRAY_SCAN_TEST_REACHED_PATH,
  };
  process.env.POLYTRAY_ISOLATED_TEST = '0';
  process.env.POLYTRAY_SCAN_TEST_HOLD_PATH = target;
  process.env.POLYTRAY_SCAN_TEST_RELEASE_PATH = releasePath;
  process.env.POLYTRAY_SCAN_TEST_REACHED_PATH = reachedPath;
  try {
    const events: DiscoveryEvent[] = [];
    for await (const event of streamDiscoverFolder(rootPath)) events.push(event);
    assert.equal(events.some((event) => event.type === 'file' && event.file.path === path.join(target, 'model.stl')), true);
    assert.equal(fs.existsSync(reachedPath), false);
    assert.equal(events.some((event) => event.type === 'discovery-complete' && !event.cancelled), true);
  } finally {
    if (oldEnv.isolated === undefined) delete process.env.POLYTRAY_ISOLATED_TEST; else process.env.POLYTRAY_ISOLATED_TEST = oldEnv.isolated;
    if (oldEnv.hold === undefined) delete process.env.POLYTRAY_SCAN_TEST_HOLD_PATH; else process.env.POLYTRAY_SCAN_TEST_HOLD_PATH = oldEnv.hold;
    if (oldEnv.release === undefined) delete process.env.POLYTRAY_SCAN_TEST_RELEASE_PATH; else process.env.POLYTRAY_SCAN_TEST_RELEASE_PATH = oldEnv.release;
    if (oldEnv.reached === undefined) delete process.env.POLYTRAY_SCAN_TEST_REACHED_PATH; else process.env.POLYTRAY_SCAN_TEST_REACHED_PATH = oldEnv.reached;
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});
