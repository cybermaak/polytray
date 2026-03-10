import fs from "fs/promises";
import path from "path";

export const THUMBNAIL_CACHE_VERSION = 1;
const CACHE_META_FILENAME = "cache-meta.json";

interface ReconcileArgs {
  thumbnailDir: string;
  referencedThumbnailPaths: string[];
}

export async function reconcileThumbnailCache({
  thumbnailDir,
  referencedThumbnailPaths,
}: ReconcileArgs) {
  await fs.mkdir(thumbnailDir, { recursive: true });

  const metaPath = path.join(thumbnailDir, CACHE_META_FILENAME);
  let versionReset = false;

  try {
    const rawMeta = await fs.readFile(metaPath, "utf8");
    const meta = JSON.parse(rawMeta) as { version?: number };
    if (meta.version !== THUMBNAIL_CACHE_VERSION) {
      versionReset = true;
    }
  } catch {
    versionReset = true;
  }

  const referenced = new Set(referencedThumbnailPaths.map((filePath) => path.resolve(filePath)));
  const files = await fs.readdir(thumbnailDir);
  for (const file of files) {
    if (!file.endsWith(".png")) continue;
    const absolutePath = path.join(thumbnailDir, file);
    if (versionReset || !referenced.has(path.resolve(absolutePath))) {
      await fs.rm(absolutePath, { force: true });
    }
  }

  await fs.writeFile(
    metaPath,
    JSON.stringify({ version: THUMBNAIL_CACHE_VERSION }, null, 2),
    "utf8",
  );

  return { versionReset };
}
