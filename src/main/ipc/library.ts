/**
 * IPC handlers for library folder management.
 */
import { BrowserWindow, dialog, ipcMain } from "electron";
import { getDb, getSetting, setSetting } from "../database";
import { IPC } from "../../shared/types";

export function registerLibraryHandlers(
  getMainWindow: () => BrowserWindow | null,
) {
  ipcMain.handle(IPC.SELECT_FOLDER, async () => {
    const mainWindow = getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
      title: "Select 3D Models Folder",
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const folderPath = result.filePaths[0];
    const folders = getSetting<string[]>("library_folders", []);
    if (!folders.includes(folderPath)) {
      folders.push(folderPath);
    }
    setSetting("library_folders", folders);
    setSetting("last_folder", folderPath);

    return folderPath;
  });

  ipcMain.handle(IPC.GET_LIBRARY_FOLDERS, () => {
    return getSetting<string[]>("library_folders", []);
  });

  ipcMain.handle(IPC.REMOVE_LIBRARY_FOLDER, (event, folderPath) => {
    let folders = getSetting<string[]>("library_folders", []);
    folders = folders.filter((f: string) => f !== folderPath);
    setSetting("library_folders", folders);
    // Remove files from this folder
    const db = getDb();
    db.prepare("DELETE FROM files WHERE directory LIKE ?").run(
      folderPath + "%",
    );
    return folders;
  });

  ipcMain.handle(IPC.GET_LAST_FOLDER, () => {
    return getSetting<string | null>("last_folder", null);
  });

  ipcMain.handle(IPC.RESCAN, async () => {
    return getSetting<string | null>("last_folder", null);
  });
}
