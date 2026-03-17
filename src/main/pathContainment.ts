import path from "path";
import { ARCHIVE_ENTRY_SEPARATOR } from "../shared/archivePaths";

interface ArchiveVirtualPath {
  archivePath: string;
  entryPath: string;
}

function parseArchiveVirtualPath(value: string): ArchiveVirtualPath | null {
  const separatorIndex = value.indexOf(ARCHIVE_ENTRY_SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }

  const archivePath = value.slice(0, separatorIndex);
  const entryPath = value
    .slice(separatorIndex + ARCHIVE_ENTRY_SEPARATOR.length)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part.length > 0 && part !== ".")
    .join("/");

  if (!archivePath) {
    return null;
  }

  return { archivePath, entryPath };
}

export function isPathContained(rootPath: string, candidatePath: string) {
  const rootArchive = parseArchiveVirtualPath(rootPath);
  const candidateArchive = parseArchiveVirtualPath(candidatePath);

  if (rootArchive || candidateArchive) {
    if (!rootArchive || !candidateArchive) {
      return false;
    }

    if (path.resolve(rootArchive.archivePath) !== path.resolve(candidateArchive.archivePath)) {
      return false;
    }

    if (!rootArchive.entryPath) {
      return true;
    }

    const relativeEntry = path.posix.relative(
      rootArchive.entryPath,
      candidateArchive.entryPath,
    );

    return (
      relativeEntry === "" ||
      (!relativeEntry.startsWith("..") && !path.posix.isAbsolute(relativeEntry))
    );
  }

  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);

  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function filterContainedPaths(
  rootPath: string,
  candidatePaths: string[],
) {
  return candidatePaths.filter((candidatePath) =>
    isPathContained(rootPath, candidatePath),
  );
}
