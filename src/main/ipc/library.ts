/**
 * IPC handlers for library folder management.
 */
import { BrowserWindow, dialog, ipcMain } from "electron";
import { getDb, getSetting } from "../database";
import { IPC } from "../../shared/types";
import { filterContainedPaths } from "../pathContainment";
import { createFileIndexRepository } from "../fileIndexing";

interface LibraryMutationOptions {
  runMutation?: <T>(operation: () => T | Promise<T>) => Promise<T>;
}

export function registerLibraryHandlers(
  getMainWindow: () => BrowserWindow | null,
  options: LibraryMutationOptions = {},
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

  ipcMain.handle(IPC.REMOVE_LIBRARY_FOLDER, async (event, folderPath) => {
    const remove = () => {
    const db = getDb();
    const rows = db.prepare("SELECT path, content_revision, scan_generation FROM files").all() as Array<{
      path: string;
      content_revision: number;
      scan_generation: number;
    }>;
    const containedPaths = filterContainedPaths(
      folderPath,
      rows.map((row) => row.path),
    );
    const contained = new Set(containedPaths);
    createFileIndexRepository(db).deleteContainedFiles(folderPath, rows
      .filter((row) => contained.has(row.path))
      .map((row) => ({
        path: row.path,
        expectedContentRevision: row.content_revision,
        scanGeneration: row.scan_generation,
      })));
    return true;
    };
    return options.runMutation ? options.runMutation(remove) : remove();
  });

  ipcMain.handle(IPC.GET_LAST_FOLDER, () => {
    return getSetting<string | null>("last_folder", null);
  });

  ipcMain.handle(IPC.RESCAN, async () => {
    return getSetting<string | null>("last_folder", null);
  });
}
