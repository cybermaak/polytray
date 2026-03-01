import { app } from "electron";
import path from "path";
import fs from "fs";
import crypto from "crypto";

let thumbnailDir = null;

export function getThumbnailDir() {
  if (!thumbnailDir) {
    thumbnailDir = path.join(app.getPath("userData"), "thumbnails");
    fs.mkdirSync(thumbnailDir, { recursive: true });
  }
  return thumbnailDir;
}

/**
 * Generates a thumbnail for a 3D model file.
 * Sends a request to the renderer process via IPC, which renders
 * the model on a hidden canvas and returns the result.
 *
 * @param {string} filePath - Absolute path to the 3D file
 * @param {string} ext - File extension
 * @param {BrowserWindow} mainWindow - The main window for IPC
 * @returns {Promise<string|null>} Path to the generated thumbnail
 */
export async function generateThumbnail(filePath, ext, mainWindow) {
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
        const { ipcMain } = require("electron");
        ipcMain.removeListener("thumbnail-generated", handler);
        resolve(null);
      }, 15000);

      const handler = (event, result) => {
        if (result.filePath === filePath) {
          clearTimeout(timeout);
          const { ipcMain } = require("electron");
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
            } catch (e) {
              console.warn("Failed to save thumbnail:", e.message);
              resolve(null);
            }
          } else {
            resolve(null);
          }
        }
      };

      const { ipcMain } = require("electron");
      ipcMain.on("thumbnail-generated", handler);
    });
  } catch (e) {
    console.warn("Thumbnail generation failed:", e.message);
    return null;
  }
}
