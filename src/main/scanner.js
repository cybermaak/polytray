import fs from "fs";
import path from "path";

const SUPPORTED_EXTENSIONS = new Set(["stl", "obj", "3mf"]);

/**
 * Recursively scans a directory for 3D files.
 * @param {string} rootPath - Root directory to scan
 * @returns {Promise<Array<{path: string, name: string, ext: string, dir: string, size: number, mtime: number}>>}
 */
export async function scanFolder(rootPath) {
  const results = [];
  await walkDir(rootPath, results);
  return results;
}

async function walkDir(dirPath, results) {
  let entries;
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (e) {
    console.warn(`Cannot read directory ${dirPath}:`, e.message);
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Skip hidden directories
      if (entry.name.startsWith(".")) continue;
      await walkDir(fullPath, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase().slice(1);
      if (SUPPORTED_EXTENSIONS.has(ext)) {
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
        } catch (e) {
          console.warn(`Cannot stat ${fullPath}:`, e.message);
        }
      }
    }
  }
}
