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
import { startWatcher, stopWatcher } from "../watcher";
import { IPC } from "../../shared/types";

export function registerSystemHandlers(
  getMainWindow: () => BrowserWindow | null,
) {
  ipcMain.on(IPC.ON_DRAG_START, (event, filePath) => {
    const icon = nativeImage.createFromPath(
      join(__dirname, "../../build/icon.png"),
    );
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

  ipcMain.handle(IPC.START_WATCHING, (event, folderPath) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      startWatcher(folderPath, mainWindow, getDb());
    }
  });

  ipcMain.handle(IPC.STOP_WATCHING, () => {
    stopWatcher();
  });
}
