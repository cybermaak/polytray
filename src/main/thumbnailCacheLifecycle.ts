import fs from "fs/promises";
import path from "path";
import { filterContainedPaths } from "./pathContainment";
import { canonicalizeThumbnailPath } from "./thumbnailIdentity";
import { THUMBNAIL_INVALIDATION_PATH_BATCH_SIZE, type ThumbnailInvalidatedData } from "../shared/types";

export const THUMBNAIL_CACHE_VERSION = 2;
const CACHE_META_FILENAME = "cache-meta.json";

export type ThumbnailInvalidationScope =
  | { kind: "all" }
  | { kind: "folder"; folderPath: string }
  | { kind: "files"; modelPaths: string[] };

export function normalizeThumbnailInvalidationScope(value: unknown): ThumbnailInvalidationScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid thumbnail invalidation scope");
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind === "all" && Object.keys(raw).length === 1) return { kind: "all" };
  if (raw.kind === "folder" && typeof raw.folderPath === "string" && raw.folderPath.trim().length > 0 && Object.keys(raw).length === 2) {
    return { kind: "folder", folderPath: raw.folderPath };
  }
  if (raw.kind === "files" && Array.isArray(raw.modelPaths) && raw.modelPaths.every((item) => typeof item === "string" && item.trim().length > 0) && Object.keys(raw).length === 2) {
    return { kind: "files", modelPaths: [...raw.modelPaths] as string[] };
  }
  throw new Error("Invalid thumbnail invalidation scope");
}

export interface ThumbnailIndexedRow {
  id: number;
  path: string;
  contentRevision: number;
  thumbnail: string | null;
}

export interface ThumbnailInvalidationSummary {
  invalidatedFileCount: number;
  removedThumbnailCount: number;
}

export interface ThumbnailInvalidationHooks {
  advanceEpochs(modelPaths: string[], invalidateAll: boolean): void;
  cancelQueued(modelPaths: string[] | null): void;
  clearReferences(rows: ThumbnailIndexedRow[], invalidateAll: boolean): number | Promise<number>;
  removeCacheFiles(invalidateAll: boolean, thumbnailPaths: string[]): number | Promise<number>;
  publish(event: ThumbnailInvalidatedData): void;
  queue(scope: ThumbnailInvalidationScope): void | Promise<void>;
}

export function createThumbnailCacheEpochStore() {
  let sequence = 0;
  let globalEpoch = 0;
  const pathEpochs = new Map<string, number>();

  return {
    current(filePath: string): number {
      return pathEpochs.get(canonicalizeThumbnailPath(filePath)) ?? globalEpoch;
    },
    advance(filePaths: string[], invalidateAll = false): number {
      if (invalidateAll) {
        globalEpoch = ++sequence;
        pathEpochs.clear();
        return globalEpoch;
      }
      let latest = globalEpoch;
      for (const filePath of new Set(filePaths.map(canonicalizeThumbnailPath))) {
        latest = ++sequence;
        pathEpochs.set(filePath, latest);
      }
      return latest;
    },
  };
}

export function readThumbnailRequestEpoch(requestKey: string): number | null {
  try {
    const parsed = JSON.parse(requestKey) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" ||
        typeof parsed[1] !== "number" || !Number.isSafeInteger(parsed[1]) || parsed[1] < 0) return null;
    return parsed[1];
  } catch {
    return null;
  }
}

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

  const resolvedDir = path.resolve(thumbnailDir);
  const referenced = new Set(referencedThumbnailPaths.map((filePath) => path.resolve(filePath)));
  const thumbnailPathsToClear = new Set<string>();
  for (const filePath of referencedThumbnailPaths) {
    const resolved = path.resolve(filePath);
    const relative = path.relative(resolvedDir, resolved);
    const contained = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    if (versionReset || !contained || path.extname(resolved).toLowerCase() !== ".png") {
      thumbnailPathsToClear.add(filePath);
      continue;
    }
    try {
      const stat = await fs.lstat(resolved);
      if (!stat.isFile() || stat.isSymbolicLink()) thumbnailPathsToClear.add(filePath);
    } catch {
      thumbnailPathsToClear.add(filePath);
    }
  }

  const invalidReferences = new Set([...thumbnailPathsToClear].map((filePath) => path.resolve(filePath)));
  const files = await fs.readdir(thumbnailDir);
  for (const file of files) {
    if (!file.endsWith(".png") && !file.endsWith(".tmp")) continue;
    const absolutePath = path.join(thumbnailDir, file);
    if (file.endsWith(".tmp") || versionReset || invalidReferences.has(path.resolve(absolutePath)) || !referenced.has(path.resolve(absolutePath))) {
      await fs.rm(absolutePath, { force: true });
    }
  }

  await fs.writeFile(
    metaPath,
    JSON.stringify({ version: THUMBNAIL_CACHE_VERSION }, null, 2),
    "utf8",
  );

  return { versionReset, thumbnailPathsToClear: [...thumbnailPathsToClear] };
}

export function selectThumbnailRowsForInvalidation<T extends Pick<ThumbnailIndexedRow, "path">>(
  rows: T[],
  scope: ThumbnailInvalidationScope,
): T[] {
  if (scope.kind === "all") return [...rows];
  if (scope.kind === "folder") {
    const contained = new Set(filterContainedPaths(scope.folderPath, rows.map((row) => row.path)));
    return rows.filter((row) => contained.has(row.path));
  }
  const selected = new Set(scope.modelPaths.map(canonicalizeThumbnailPath));
  return rows.filter((row) => selected.has(canonicalizeThumbnailPath(row.path)));
}

export function selectThumbnailCachePathsToRemove(thumbnailDir: string, rows: ThumbnailIndexedRow[]): string[] {
  const root = path.resolve(thumbnailDir);
  return [...new Set(rows.flatMap((row) => {
    if (!row.thumbnail || !path.isAbsolute(row.thumbnail)) return [];
    const candidate = path.resolve(row.thumbnail);
    const relative = path.relative(root, candidate);
    const contained = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    return contained && path.extname(candidate).toLowerCase() === ".png" ? [candidate] : [];
  }))];
}

export async function removeThumbnailCacheFiles(
  thumbnailDir: string,
  invalidateAll: boolean,
  thumbnailPaths: string[],
): Promise<number> {
  let targets: string[];
  if (invalidateAll) {
    try {
      targets = (await fs.readdir(thumbnailDir))
        .filter((file) => file.endsWith(".png") || file.endsWith(".tmp"))
        .map((file) => path.join(thumbnailDir, file));
    } catch {
      return 0;
    }
  } else {
    targets = [...new Set(thumbnailPaths.filter((filePath) =>
      path.isAbsolute(filePath) && path.extname(filePath).toLowerCase() === ".png" &&
      filterContainedPaths(thumbnailDir, [filePath]).length === 1,
    ).map((filePath) => path.resolve(filePath)))];
  }
  await Promise.all(targets.map((filePath) => fs.rm(filePath, { force: true })));
  return targets.filter((filePath) => path.extname(filePath).toLowerCase() === ".png").length;
}

export function createThumbnailInvalidationEvents(
  scope: ThumbnailInvalidationScope,
  modelPaths: string[],
  thumbnailPaths: string[],
): ThumbnailInvalidatedData[] {
  if (scope.kind === "all") return [{ kind: "all" }];
  const normalizedModelPaths = [...new Set(modelPaths.map(canonicalizeThumbnailPath))];
  const normalizedThumbnailPaths = [...new Set(thumbnailPaths.filter((filePath) => path.isAbsolute(filePath)).map((filePath) => path.resolve(filePath)))];
  const chunkSize = THUMBNAIL_INVALIDATION_PATH_BATCH_SIZE;
  const eventCount = Math.max(1, Math.ceil(normalizedModelPaths.length / chunkSize), Math.ceil(normalizedThumbnailPaths.length / chunkSize));
  return Array.from({ length: eventCount }, (_, index) => ({
    kind: "paths" as const,
    modelPaths: normalizedModelPaths.slice(index * chunkSize, (index + 1) * chunkSize),
    thumbnailPaths: normalizedThumbnailPaths.slice(index * chunkSize, (index + 1) * chunkSize),
  }));
}

export async function executeThumbnailInvalidation(
  scope: ThumbnailInvalidationScope,
  selectedRows: ThumbnailIndexedRow[],
  thumbnailDir: string,
  hooks: ThumbnailInvalidationHooks,
): Promise<ThumbnailInvalidationSummary> {
  const requestedPaths = scope.kind === "files" ? scope.modelPaths.map(canonicalizeThumbnailPath) : [];
  const modelPaths = [...new Set([
    ...selectedRows.map((row) => canonicalizeThumbnailPath(row.path)),
    ...requestedPaths,
  ])];
  const thumbnailPaths = scope.kind === "all" ? [] : selectThumbnailCachePathsToRemove(thumbnailDir, selectedRows);

  hooks.advanceEpochs(modelPaths, scope.kind === "all");
  hooks.cancelQueued(scope.kind === "all" ? null : modelPaths);
  const invalidatedFileCount = await hooks.clearReferences(selectedRows, scope.kind === "all");
  const removedThumbnailCount = await hooks.removeCacheFiles(scope.kind === "all", thumbnailPaths);
  for (const event of createThumbnailInvalidationEvents(scope, modelPaths, thumbnailPaths)) hooks.publish(event);
  await hooks.queue(scope);

  return { invalidatedFileCount, removedThumbnailCount };
}
