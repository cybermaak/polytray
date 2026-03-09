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
import { getDb, setSetting } from "../database";
import { startWatcher, stopWatcher } from "../watcher";
import { IPC } from "../../shared/types";

export function registerSystemHandlers(
  getMainWindow: () => BrowserWindow | null,
) {
  ipcMain.on(IPC.ON_DRAG_START, (event, filePath) => {
    // Try to use the file's thumbnail as the drag icon
    let icon: Electron.NativeImage | undefined = undefined;
    try {
      const db = getDb();
      const row = db
        .prepare("SELECT thumbnail FROM files WHERE path = ?")
        .get(filePath) as { thumbnail: string | null } | undefined;
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
      file: filePath,
      icon: icon,
    });
  });

  ipcMain.on(IPC.SHOW_CONTEXT_MENU, (event, filePath) => {
    const template = [
      {
        label: "Reveal in Finder / Explorer",
        click: () => {
          shell.showItemInFolder(filePath);
        },
      },
      {
        label: "Copy Absolute Path",
        click: () => {
          clipboard.writeText(filePath);
        },
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender)! });
  });

  ipcMain.on(IPC.SHOW_FOLDER_CONTEXT_MENU, (event, folderPath) => {
    const template = [
      {
        label: "Refresh Thumbnails",
        click: () => {
          const win = getMainWindow();
          if (win) {
            win.webContents.send('trigger-refresh-folder', folderPath);
          }
        },
      },
      {
        label: "Rescan Folder",
        click: () => {
          const win = getMainWindow();
          if (win) {
            win.webContents.send('trigger-rescan-folder', folderPath);
          }
        },
      },
      { type: 'separator' as const },
      {
        label: "Reveal in Finder / Explorer",
        click: () => {
          shell.showItemInFolder(folderPath);
        },
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender)! });
  });

  ipcMain.handle(IPC.START_WATCHING, async (event, folderPaths: string[]) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      await startWatcher(folderPaths, mainWindow, getDb());
    }
  });

  ipcMain.handle(IPC.STOP_WATCHING, async () => {
    await stopWatcher();
  });

  ipcMain.handle(IPC.UPDATE_SETTING, (_event, key: string, value: string | number | boolean) => {
    setSetting(key, value);
    return true;
  });
}
