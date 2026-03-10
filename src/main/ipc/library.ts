/**
 * IPC handlers for library folder management.
 */
import { BrowserWindow, dialog, ipcMain } from "electron";
import { getDb, getSetting } from "../database";
import { IPC } from "../../shared/types";
import { filterContainedPaths } from "../pathContainment";

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

    return result.filePaths[0];
  });

  ipcMain.handle(IPC.GET_LIBRARY_FOLDERS, () => {
    return getSetting<string[]>("library_folders", []);
  });

  ipcMain.handle(IPC.REMOVE_LIBRARY_FOLDER, (event, folderPath) => {
    const db = getDb();
    const rows = db.prepare("SELECT path FROM files").all() as Array<{ path: string }>;
    const containedPaths = filterContainedPaths(
      folderPath,
      rows.map((row) => row.path),
    );
    const deleteFiles = db.transaction((paths: string[]) => {
      const stmt = db.prepare("DELETE FROM files WHERE path = ?");
      for (const filePath of paths) {
        stmt.run(filePath);
      }
    });
    deleteFiles(containedPaths);
    return true;
  });

  ipcMain.handle(IPC.GET_LAST_FOLDER, () => {
    return getSetting<string | null>("last_folder", null);
  });

  ipcMain.handle(IPC.RESCAN, async () => {
    return getSetting<string | null>("last_folder", null);
  });
}
