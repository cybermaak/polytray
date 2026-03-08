import chokidar, { FSWatcher } from "chokidar";

let watcher: FSWatcher | null = null;

// Ensure this only runs as an Electron utilityProcess
if (process.parentPort) {
  process.parentPort.on("message", (e: Electron.MessageEvent) => {
    const msg = e.data;
    if (msg.type === "start") {
      if (watcher) watcher.close();
      
      watcher = chokidar.watch(msg.folderPaths, {
        ignored: /(^|[/\\])\./, // ignore dotfiles
        persistent: true,
        ignoreInitial: true,
        depth: 99,
        awaitWriteFinish: {
          stabilityThreshold: msg.watcherStability || 1000,
          pollInterval: 100,
        },
      });

      watcher.on("add", (filePath) => process.parentPort.postMessage({ type: "add", filePath }));
      watcher.on("change", (filePath) => process.parentPort.postMessage({ type: "change", filePath }));
      watcher.on("unlink", (filePath) => process.parentPort.postMessage({ type: "unlink", filePath }));
      watcher.on("error", (error) => console.error("Worker chokidar error:", error));
      
    } else if (msg.type === "stop") {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      process.exit(0);
    }
  });
}
