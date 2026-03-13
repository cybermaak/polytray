import chokidar, { FSWatcher } from 'chokidar';

let watcher: FSWatcher | null = null;

async function closeWatcher() {
  if (!watcher) {
    return;
  }

  const currentWatcher = watcher;
  watcher = null;
  await currentWatcher.close();
}

if (process.parentPort) {
  process.parentPort.on('message', async (e: Electron.MessageEvent) => {
    const msg = e.data;
    if (msg.type === 'start') {
      await closeWatcher();

      watcher = chokidar.watch(msg.folderPaths, {
        ignored: /(^|[/\\])\./,
        persistent: true,
        ignoreInitial: true,
        depth: 99,
        awaitWriteFinish: {
          stabilityThreshold: msg.watcherStability || 1000,
          pollInterval: 100,
        },
      });

      watcher.on('add', (filePath) => process.parentPort?.postMessage({ type: 'add', filePath }));
      watcher.on('change', (filePath) => process.parentPort?.postMessage({ type: 'change', filePath }));
      watcher.on('unlink', (filePath) => process.parentPort?.postMessage({ type: 'unlink', filePath }));
      watcher.on('error', (error) => console.error('Worker chokidar error:', error));
    } else if (msg.type === 'stop') {
      await closeWatcher();
      process.exit(0);
    }
  });
}
