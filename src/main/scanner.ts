import fs from "fs";
import path from "path";
import * as unzipper from "unzipper";
import { EXT_SET } from "../shared/types";
import {
  ARCHIVE_EXT_SET,
  createArchiveEntryPath,
  getArchiveEntryBaseName,
  getArchiveEntryDirectory,
  getArchiveEntryExtension,
  isSupportedArchiveEntry,
} from "../shared/archivePaths";

interface ScannedFile {
  path: string;
  name: string;
  ext: string;
  dir: string;
  size: number;
  mtime: number;
}

/**
 * Recursively scans a directory for 3D files.
 * @param {string} rootPath - Root directory to scan
 */
export async function scanFolder(rootPath: string): Promise<ScannedFile[]> {
  const results: ScannedFile[] = [];
  await walkDir(rootPath, results);
  return results;
}

async function walkDir(dirPath: string, results: ScannedFile[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (e: unknown) {
    console.warn(`Cannot read directory ${dirPath}:`, (e as Error).message);
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Skip tests/fixtures directory
      if (entry.name === "fixtures" && dirPath.includes(path.sep + "tests"))
        continue;
      await walkDir(fullPath, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase().slice(1);
      if (EXT_SET.has(ext)) {
        try {
          const stat = await fs.promises.stat(fullPath);
          results.push({
            path: fullPath,
            name: path.basename(entry.name, "." + ext),
            ext,
            dir: dirPath,
            size: stat.size,
            mtime: Math.floor(stat.mtimeMs),
          });
        } catch (e: unknown) {
          console.warn(`Cannot stat ${fullPath}:`, (e as Error).message);
        }
      } else if (ARCHIVE_EXT_SET.has(ext)) {
        await scanArchive(fullPath, dirPath, results);
      }
    }
  }
}

async function scanArchive(
  archivePath: string,
  parentDir: string,
  results: ScannedFile[],
) {
  try {
    const [directory, stat] = await Promise.all([
      unzipper.Open.file(archivePath),
      fs.promises.stat(archivePath),
    ]);

    for (const entry of directory.files) {
      if (entry.type !== "File" || !isSupportedArchiveEntry(entry.path)) {
        continue;
      }

      const virtualPath = createArchiveEntryPath(archivePath, entry.path);
      results.push({
        path: virtualPath,
        name: getArchiveEntryBaseName(entry.path),
        ext: getArchiveEntryExtension(entry.path),
        dir: getArchiveEntryDirectory(virtualPath) || parentDir,
        size: entry.uncompressedSize,
        mtime: Math.floor(stat.mtimeMs),
      });
    }
  } catch (e: unknown) {
    console.warn(`Cannot inspect archive ${archivePath}:`, (e as Error).message);
  }
}
