import chokidar, { FSWatcher } from 'chokidar';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createWatcherRootStatusPoller } from './watcherLifecycle';

let watcher: FSWatcher | null = null;
let watchedRoots: string[] = [];
let rootAvailability = new Map<string, boolean>();
let generation = 0;
let rootStatusPoller: ReturnType<typeof createWatcherRootStatusPoller> | null = null;

function post(generationAtStart: number, message: unknown) {
  if (generationAtStart === generation) process.parentPort?.postMessage(message);
}

async function reportRootAvailability(rootPath: string, available: boolean, generationAtStart: number) {
  if (generationAtStart !== generation || rootAvailability.get(rootPath) === available) return;
  rootAvailability.set(rootPath, available);
  post(generationAtStart, { type: 'root-status', folderPath: rootPath, available });
}

async function inspectRoot(rootPath: string, generationAtStart: number) {
  try {
    const stat = await fs.stat(rootPath);
    await reportRootAvailability(rootPath, stat.isDirectory(), generationAtStart);
  } catch {
    await reportRootAvailability(rootPath, false, generationAtStart);
  }
}

async function waitForIsolatedRootStartRelease(roots: string[], generationAtStart: number) {
  if (process.env.POLYTRAY_ISOLATED_TEST !== '1') return;
  const rootPath = process.env.POLYTRAY_WATCHER_TEST_ROOT_PATH;
  const releasePath = process.env.POLYTRAY_WATCHER_TEST_ROOT_RELEASE_PATH;
  const scratchDir = process.env.POLYTRAY_PERF_SCRATCH;
  if (!rootPath || !releasePath || !scratchDir || !path.isAbsolute(rootPath) ||
      !path.isAbsolute(releasePath) || !path.isAbsolute(scratchDir) ||
      !roots.includes(path.resolve(rootPath))) return;
  const relativeReleasePath = path.relative(path.resolve(scratchDir), path.resolve(releasePath));
  if (!relativeReleasePath || relativeReleasePath === '..' || relativeReleasePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeReleasePath)) return;

  while (generationAtStart === generation) {
    try {
      await fs.access(releasePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

async function closeWatcher() {
  rootStatusPoller?.stop();
  rootStatusPoller = null;
  if (!watcher) {
    return;
  }

  const currentWatcher = watcher;
  watcher = null;
  await currentWatcher.close();
}

process.once('exit', () => {
  rootStatusPoller?.stop();
  rootStatusPoller = null;
});

if (process.parentPort) {
  process.parentPort.on('message', async (e: Electron.MessageEvent) => {
    const msg = e.data;
    if (msg.type === 'start') {
      generation++;
      const generationAtStart = generation;
      await closeWatcher();
      watchedRoots = [...new Set((msg.folderPaths as string[]).map((folderPath) => path.resolve(folderPath)))];
      rootAvailability = new Map();
      await waitForIsolatedRootStartRelease(watchedRoots, generationAtStart);
      if (generationAtStart !== generation) return;

      watcher = chokidar.watch(watchedRoots, {
        ignored: /(^|[/\\])\./,
        persistent: true,
        ignoreInitial: true,
        depth: 99,
        awaitWriteFinish: {
          stabilityThreshold: msg.watcherStability || 1000,
          pollInterval: 100,
        },
      });

      watcher.on('add', (filePath) => post(generationAtStart, { type: 'add', filePath }));
      watcher.on('change', (filePath) => post(generationAtStart, { type: 'change', filePath }));
      watcher.on('unlink', (filePath) => post(generationAtStart, { type: 'unlink', filePath }));
      watcher.on('addDir', (filePath) => {
        const root = watchedRoots.find((rootPath) => path.resolve(filePath) === rootPath);
        if (root) void reportRootAvailability(root, true, generationAtStart);
      });
      watcher.on('unlinkDir', (filePath) => {
        const root = watchedRoots.find((rootPath) => path.resolve(filePath) === rootPath);
        if (root) void reportRootAvailability(root, false, generationAtStart);
      });
      watcher.on('ready', () => {
        for (const root of watchedRoots) void inspectRoot(root, generationAtStart);
      });
      watcher.on('error', (error) => console.error('Worker chokidar error:', error));
      rootStatusPoller = createWatcherRootStatusPoller(
        watchedRoots,
        (rootPath) => inspectRoot(rootPath, generationAtStart),
      );
      rootStatusPoller.start();
    } else if (msg.type === 'stop') {
      generation++;
      await closeWatcher();
      watchedRoots = [];
      rootAvailability.clear();
      process.exit(0);
    }
  });
}
