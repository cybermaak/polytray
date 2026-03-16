export const ARCHIVE_ENTRY_SEPARATOR = "::entry::";
export const SUPPORTED_ARCHIVE_EXTENSIONS = ["zip"] as const;
export const ARCHIVE_EXT_SET = new Set<string>(SUPPORTED_ARCHIVE_EXTENSIONS);

export interface ArchiveEntryLocation {
  archivePath: string;
  entryPath: string;
}

function posixDirname(value: string) {
  const normalized = value.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return ".";
  }
  return normalized.slice(0, lastSlash) || "/";
}

function posixExtname(value: string) {
  const normalized = value.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  const lastDot = normalized.lastIndexOf(".");
  if (lastDot === -1 || lastDot < lastSlash) {
    return "";
  }
  return normalized.slice(lastDot);
}

function posixBasename(value: string, suffix = "") {
  const normalized = value.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  const base = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  return suffix && base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
}

export function normalizeArchiveEntryPath(entryPath: string) {
  return entryPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part.length > 0 && part !== ".")
    .join("/");
}

export function createArchiveEntryPath(archivePath: string, entryPath: string) {
  return `${archivePath}${ARCHIVE_ENTRY_SEPARATOR}${normalizeArchiveEntryPath(entryPath)}`;
}

export function parseArchiveEntryPath(filePath: string): ArchiveEntryLocation | null {
  const separatorIndex = filePath.indexOf(ARCHIVE_ENTRY_SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }

  const archivePath = filePath.slice(0, separatorIndex);
  const entryPath = normalizeArchiveEntryPath(
    filePath.slice(separatorIndex + ARCHIVE_ENTRY_SEPARATOR.length),
  );

  if (!archivePath || !entryPath) {
    return null;
  }

  return { archivePath, entryPath };
}

export function isArchiveEntryPath(filePath: string) {
  return parseArchiveEntryPath(filePath) !== null;
}

export function getArchiveEntryDirectory(filePath: string) {
  const parsed = parseArchiveEntryPath(filePath);
  if (!parsed) {
    return posixDirname(filePath);
  }

  const entryDir = posixDirname(parsed.entryPath);
  if (entryDir === ".") {
    return `${parsed.archivePath}${ARCHIVE_ENTRY_SEPARATOR}`;
  }

  return `${parsed.archivePath}${ARCHIVE_ENTRY_SEPARATOR}${entryDir}`;
}

export function getArchiveEntryBaseName(entryPath: string) {
  const normalized = normalizeArchiveEntryPath(entryPath);
  const ext = posixExtname(normalized);
  return posixBasename(normalized, ext);
}

export function getArchiveEntryExtension(entryPath: string) {
  return posixExtname(normalizeArchiveEntryPath(entryPath)).toLowerCase().slice(1);
}

export function isSupportedArchiveEntry(entryPath: string) {
  return getArchiveEntryExtension(entryPath) === "stl"
    || getArchiveEntryExtension(entryPath) === "obj"
    || getArchiveEntryExtension(entryPath) === "3mf";
}
