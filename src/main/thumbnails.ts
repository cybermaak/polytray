import { app, BrowserWindow, ipcMain, IpcMainEvent } from "electron";
import path from "path";
import fs from "fs";
import crypto from "crypto";

let thumbnailDir: string | null = null;

export function getThumbnailDir(): string {
  if (!thumbnailDir) {
    thumbnailDir = path.join(app.getPath("userData"), "thumbnails");
    fs.mkdirSync(thumbnailDir, { recursive: true });
  }
  return thumbnailDir;
}

interface ThumbnailResult {
  filePath: string;
  thumbPath: string;
  success: boolean;
  dataUrl?: string;
}

/**
 * Generates a thumbnail for a 3D model file.
 * Sends a request to the renderer process via IPC, which renders
 * the model on a hidden canvas and returns the result.
 */
export async function generateThumbnail(
  filePath: string,
  ext: string,
  mainWindow: BrowserWindow,
): Promise<string | null> {
  const dir = getThumbnailDir();
  const hash = crypto
    .createHash("sha256")
    .update(filePath)
    .digest("hex")
    .slice(0, 16);
  const thumbPath = path.join(dir, `${hash}.png`);

  // If thumbnail already exists, just return it
  if (fs.existsSync(thumbPath)) {
    return thumbPath;
  }

  try {
    mainWindow.webContents.send("generate-thumbnail-request", {
      filePath,
      ext,
      thumbPath,
    });

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ipcMain.removeListener("thumbnail-generated", handler);
        resolve(null);
      }, 15000);

      const handler = (event: IpcMainEvent, result: ThumbnailResult) => {
        if (result.filePath === filePath) {
          clearTimeout(timeout);
          ipcMain.removeListener("thumbnail-generated", handler);

          if (result.success && result.dataUrl) {
            try {
              // Convert data URL to file
              const base64Data = result.dataUrl.replace(
                /^data:image\/png;base64,/,
                "",
              );
              fs.writeFileSync(thumbPath, Buffer.from(base64Data, "base64"));
              resolve(thumbPath);
            } catch (e: any) {
              console.warn("Failed to save thumbnail:", e.message);
              resolve(null);
            }
          } else {
            resolve(null);
          }
        }
      };

      ipcMain.on("thumbnail-generated", handler);
    });
  } catch (e: any) {
    console.warn("Thumbnail generation failed:", e.message);
    return null;
  }
}
