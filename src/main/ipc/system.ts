/**
 * IPC handlers for system interactions: drag-and-drop, context menus, file watching.
 */
import {
  BrowserWindow,
  ipcMain,
  nativeImage,
  Menu,
  shell,
  clipboard,
} from "electron";
import { join } from "path";
import { getDb } from "../database";
import { startWatcher, stopWatcher, updateWatcherSettings } from "../watcher";
import { IPC, PreviewMetricData, RuntimeSettingsData } from "../../shared/types";
import type { SlicerContextMenuRequest } from "../../shared/types";
import { ARCHIVE_ENTRY_SEPARATOR } from "../../shared/archivePaths";
import { startWatcherThroughMutationGate } from "../watcherMutationGate";
import { createSlicerContextMenuAction, sendSlicerContextMenuRequest, type SlicerContextMenuFile } from "../slicerContextMenu";
import {
  parseFilePath,
  parseFolderPath,
  parseFolderPathList,
  parsePreviewMetric,
  parseRuntimeSettings,
} from "./runtimeValidation";

interface SystemMutationOptions {
  runMutation?: <T>(operation: () => T | Promise<T>) => Promise<T>;
}

function getIndexedContextMenuFile(filePath: unknown): SlicerContextMenuFile | null {
  if (typeof filePath !== "string" || !filePath) return null;
  return getDb().prepare(`
    SELECT id AS fileId, path, extension, content_revision AS contentRevision
    FROM files WHERE path = ?
  `).get(filePath) as SlicerContextMenuFile | undefined ?? null;
}

export function registerSystemHandlers(
  getMainWindow: () => BrowserWindow | null,
  options: SystemMutationOptions = {},
) {
  ipcMain.on(IPC.ON_DRAG_START, (event, filePath) => {
    const parsedFilePath = parseFilePath(filePath);
    // Try to use the file's thumbnail as the drag icon
    let icon: Electron.NativeImage | undefined = undefined;
    try {
      const db = getDb();
      const row = db
        .prepare("SELECT thumbnail FROM files WHERE path = ?")
        .get(parsedFilePath) as { thumbnail: string | null } | undefined;
      if (row?.thumbnail) {
        const thumbImage = nativeImage.createFromPath(row.thumbnail);
        if (!thumbImage.isEmpty()) {
          // Resize to a reasonable drag icon size
          icon = thumbImage.resize({ width: 128, height: 128 });
        }
      }
    } catch (_e) {}
    if (!icon) {
      icon = nativeImage.createFromPath(
        join(__dirname, "../../build/icon.png"),
      ).resize({ width: 128, height: 128 });
    }
    event.sender.startDrag({
      file: parsedFilePath,
      icon: icon,
    });
  });

  ipcMain.on(IPC.SHOW_CONTEXT_MENU, (event, filePath) => {
    const parsedFilePath = parseFilePath(filePath);
    const indexedFile = getIndexedContextMenuFile(parsedFilePath);
    const slicerAction = createSlicerContextMenuAction(indexedFile, (captured) => {
      sendSlicerContextMenuRequest(captured, () => getIndexedContextMenuFile(parsedFilePath), current =>
        event.sender.send(IPC.SLICER_CONTEXT_MENU_REQUEST, current satisfies SlicerContextMenuRequest));
    });
    const template: Electron.MenuItemConstructorOptions[] = [
      ...(slicerAction ? [slicerAction, { type: "separator" as const }] : []),
      {
        label: "Reveal in Finder / Explorer",
        click: () => {
          shell.showItemInFolder(parsedFilePath);
        },
      },
      {
        label: "Copy Absolute Path",
        click: () => {
          clipboard.writeText(parsedFilePath);
        },
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender)! });
  });

  ipcMain.on(IPC.SHOW_FOLDER_CONTEXT_MENU, (event, folderPath) => {
    const parsedFolderPath = parseFolderPath(folderPath);
    const template = [
      {
        label: "Refresh Thumbnails",
        click: () => {
          const win = getMainWindow();
          if (win) {
            win.webContents.send('trigger-refresh-folder', parsedFolderPath);
          }
        },
      },
      {
        label: "Rescan Folder",
        click: () => {
          const win = getMainWindow();
          if (win) {
            win.webContents.send('trigger-rescan-folder', parsedFolderPath);
          }
        },
      },
      { type: 'separator' as const },
      {
        label: "Reveal in Finder / Explorer",
        click: () => {
          shell.showItemInFolder(parsedFolderPath);
        },
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender)! });
  });

  ipcMain.on(IPC.SHOW_ARCHIVE_CONTEXT_MENU, (event, path: unknown, isSummary: unknown) => {
    if (typeof path !== "string" || !path.trim()) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    const separatorIndex = path.indexOf(ARCHIVE_ENTRY_SEPARATOR);
    const archivePath = separatorIndex !== -1 ? path.slice(0, separatorIndex) : path;
    const archiveVirtualRoot = `${archivePath}${ARCHIVE_ENTRY_SEPARATOR}`;

    const indexedFile = isSummary === true ? null : getIndexedContextMenuFile(path);
    const slicerAction = createSlicerContextMenuAction(indexedFile, (captured) => {
      sendSlicerContextMenuRequest(captured, () => getIndexedContextMenuFile(path), current =>
        event.sender.send(IPC.SLICER_CONTEXT_MENU_REQUEST, current satisfies SlicerContextMenuRequest));
    });
    const template = isSummary
      ? [
          {
            label: "Browse Archive",
            click: () => win.webContents.send("trigger-open-archive", archiveVirtualRoot),
          },
          { type: "separator" as const },
          {
            label: "Reveal in Finder / Explorer",
            click: () => shell.showItemInFolder(archivePath),
          },
          {
            label: "Copy Archive Path",
            click: () => clipboard.writeText(archivePath),
          },
        ]
      : [
          ...(slicerAction ? [slicerAction, { type: "separator" as const }] : []),
          {
            label: "Reveal Archive in Finder / Explorer",
            click: () => shell.showItemInFolder(archivePath),
          },
          {
            label: "Copy Archive Path",
            click: () => clipboard.writeText(archivePath),
          },
        ];

    Menu.buildFromTemplate(template).popup({ window: win });
  });

  ipcMain.on(IPC.PREVIEW_METRIC, (_event, metric: PreviewMetricData) => {
    console.info("[PreviewMetrics]", parsePreviewMetric(metric));
  });

  ipcMain.handle(
    IPC.START_WATCHING,
    async (event, folderPaths: string[], settings: RuntimeSettingsData) => {
    const parsedFolderPaths = parseFolderPathList(folderPaths);
    const parsedSettings = parseRuntimeSettings(settings);
    const mainWindow = getMainWindow();
    if (mainWindow) {
      await startWatcherThroughMutationGate(
        (runMutation) => startWatcher(parsedFolderPaths, mainWindow, getDb(), parsedSettings, runMutation),
        options.runMutation,
      );
    }
  });

  ipcMain.handle(IPC.STOP_WATCHING, async () => {
    if (options.runMutation) await options.runMutation(() => stopWatcher());
    else await stopWatcher();
  });

  ipcMain.handle(IPC.UPDATE_WATCHER_SETTINGS, (_event, settings: RuntimeSettingsData) =>
    updateWatcherSettings(parseRuntimeSettings(settings)),
  );

}
