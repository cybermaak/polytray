import path from "path";
import {
  LibraryQuery,
  PreviewMetricData,
  PreviewParseCancelRequestData,
  PreviewParseRequestData,
  PreviewParseSettlementData,
  RuntimeSettingsData,
  SortOptions,
  UpdateFileMetadataData,
} from "../../shared/types";
import { normalizeFileTags } from "../../shared/fileTags";
import { normalizeRuntimeSettings } from "../../shared/settings";
import { ARCHIVE_ENTRY_SEPARATOR, parseArchiveEntryPath } from "../../shared/archivePaths";
import { SUPPORTED_EXTENSIONS } from "../../shared/types";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseFolderPath(value: unknown): string {
  if (!isNonEmptyString(value)) {
    throw new Error("Invalid folder path");
  }
  return value;
}

export function parseFilePath(value: unknown): string {
  if (!isNonEmptyString(value)) {
    throw new Error("Invalid file path");
  }
  return value;
}

export function parseThumbnailPath(value: unknown): string {
  if (!isNonEmptyString(value)) {
    throw new Error("Invalid thumbnail path");
  }
  return value;
}

export function parseExtension(value: unknown): string {
  if (!isNonEmptyString(value)) {
    throw new Error("Invalid file extension");
  }
  return value.toLowerCase();
}

export function parseFolderPathList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
    throw new Error("Invalid folder path list");
  }
  return value;
}

export function parseRuntimeSettings(value: unknown): RuntimeSettingsData {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid runtime settings");
  }

  const normalized = normalizeRuntimeSettings(value);
  const raw = value as Partial<RuntimeSettingsData>;

  const numericKeys: Array<keyof RuntimeSettingsData> = [
    "thumbnail_timeout",
    "scanning_batch_size",
    "watcher_stability",
    "page_size",
  ];

  for (const key of numericKeys) {
    if (typeof raw[key] !== "number" || !Number.isFinite(raw[key] as number)) {
      throw new Error("Invalid runtime settings");
    }
  }

  if (typeof raw.thumbnailColor !== "string") {
    throw new Error("Invalid runtime settings");
  }

  return normalized;
}

export function parsePreviewParseRequest(value: unknown): PreviewParseRequestData {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid preview parse request");
  }

  const request = value as Partial<PreviewParseRequestData>;
  const extension = typeof request.extension === "string" ? request.extension.toLowerCase() : "";
  const archiveEntry = typeof request.path === "string" ? parseArchiveEntryPath(request.path) : null;
  const physicalPath = archiveEntry?.archivePath ?? request.path;
  const validPathEncoding = typeof request.path === "string" &&
    (!request.path.includes(ARCHIVE_ENTRY_SEPARATOR) || Boolean(archiveEntry));
  const isAbsolutePath = typeof physicalPath === "string" &&
    (path.isAbsolute(physicalPath) || path.win32.isAbsolute(physicalPath));
  if (
    !isNonEmptyString(request.requestId) ||
    !isNonEmptyString(request.path) ||
    !validPathEncoding ||
    !isAbsolutePath ||
    !SUPPORTED_EXTENSIONS.includes(extension as typeof SUPPORTED_EXTENSIONS[number]) ||
    !Number.isSafeInteger(request.contentRevision) ||
    (request.contentRevision as number) < 0
  ) {
    throw new Error("Invalid preview parse request");
  }

  return {
    requestId: request.requestId,
    path: request.path,
    extension,
    contentRevision: request.contentRevision as number,
  };
}

export function parsePreviewParseCancelRequest(value: unknown): PreviewParseCancelRequestData {
  if (!value || typeof value !== "object") throw new Error("Invalid preview parse cancellation");
  const request = value as Partial<PreviewParseCancelRequestData>;
  if (
    !isNonEmptyString(request.requestId) ||
    !["replaced", "user", "disposed", "timeout"].includes(request.reason ?? "")
  ) {
    throw new Error("Invalid preview parse cancellation");
  }
  return { requestId: request.requestId, reason: request.reason as PreviewParseCancelRequestData["reason"] };
}

export function parsePreviewParseSettlementRequest(value: unknown): PreviewParseSettlementData {
  if (!value || typeof value !== "object") throw new Error("Invalid preview parse settlement");
  const settlement = value as Partial<PreviewParseSettlementData>;
  if (Object.keys(value).some((key) => key !== "requestId" && key !== "error") ||
    !isNonEmptyString(settlement.requestId) ||
    (settlement.error !== undefined &&
      (typeof settlement.error !== "string" || settlement.error.length > 2048))) {
    throw new Error("Invalid preview parse settlement");
  }
  return {
    requestId: settlement.requestId,
    ...(settlement.error === undefined ? {} : { error: settlement.error }),
  };
}

export function parsePreviewMetric(value: unknown): PreviewMetricData {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid preview metric");
  }

  const metric = value as Partial<PreviewMetricData>;
  const validSources = new Set<PreviewMetricData["source"]>([
    "hidden-renderer",
    "viewer",
  ]);
  const validPhases = new Set<PreviewMetricData["phase"]>([
    "fetch",
    "parse",
    "serialize",
    "background-total",
    "background-wait",
    "build",
    "preview-total",
  ]);

  if (
    !isNonEmptyString(metric.filePath) ||
    !isNonEmptyString(metric.ext) ||
    typeof metric.durationMs !== "number" ||
    !Number.isFinite(metric.durationMs) ||
    !metric.source ||
    !validSources.has(metric.source) ||
    !metric.phase ||
    !validPhases.has(metric.phase)
  ) {
    throw new Error("Invalid preview metric");
  }

  if (
    (metric.meshCount !== undefined &&
      (typeof metric.meshCount !== "number" || !Number.isFinite(metric.meshCount))) ||
    (metric.payloadBytes !== undefined &&
      (typeof metric.payloadBytes !== "number" || !Number.isFinite(metric.payloadBytes)))
  ) {
    throw new Error("Invalid preview metric");
  }

  return {
    source: metric.source,
    phase: metric.phase,
    filePath: metric.filePath,
    ext: metric.ext.toLowerCase(),
    durationMs: metric.durationMs,
    meshCount: metric.meshCount,
    payloadBytes: metric.payloadBytes,
  };
}

export function parseSortOptions(value: unknown): SortOptions {
  if (!value || typeof value !== "object") {
    return {};
  }

  const raw = value as SortOptions;
  const sort =
    typeof raw.sort === "string" && ["name", "size", "date", "vertices", "faces"].includes(raw.sort)
      ? raw.sort
      : undefined;
  const order = raw.order === "DESC" ? "DESC" : raw.order === "ASC" ? "ASC" : undefined;
  const folder = typeof raw.folder === "string" ? raw.folder : null;
  const extension = typeof raw.extension === "string" ? raw.extension.toLowerCase() : null;
  const search = typeof raw.search === "string" ? raw.search : undefined;
  const limit = typeof raw.limit === "number" && Number.isFinite(raw.limit) ? Math.max(0, Math.floor(raw.limit)) : undefined;
  const offset = typeof raw.offset === "number" && Number.isFinite(raw.offset) ? Math.max(0, Math.floor(raw.offset)) : undefined;

  return {
    sort,
    order,
    folder,
    extension,
    search,
    limit,
    offset,
  };
}

export function parseLibraryQuery(value: unknown): LibraryQuery {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid library query");
  }
  const raw = value as Record<string, unknown>;
  const validSorts = ["name", "size", "date", "vertices", "faces"] as const;
  const sort = raw.sort === undefined ? "name" : raw.sort;
  const direction = raw.direction === undefined ? "ASC" : raw.direction;
  if (typeof sort !== "string" || !validSorts.includes(sort as (typeof validSorts)[number])) {
    throw new Error("Invalid library query");
  }
  if (direction !== "ASC" && direction !== "DESC") throw new Error("Invalid library query");

  const extension = raw.extension === undefined || raw.extension === null
    ? null
    : typeof raw.extension === "string" && raw.extension.length > 0
      ? raw.extension.toLowerCase()
      : null;
  if (raw.extension !== undefined && raw.extension !== null && extension === null) {
    throw new Error("Invalid library query");
  }
  const folder = raw.folder === undefined || raw.folder === null
    ? null
    : typeof raw.folder === "string" && raw.folder.length > 0
      ? parseFolderPath(raw.folder)
      : null;
  if (raw.folder !== undefined && raw.folder !== null && folder === null) {
    throw new Error("Invalid library query");
  }
  const search = raw.search === undefined ? "" : raw.search;
  if (typeof search !== "string") throw new Error("Invalid library query");

  let collectionPaths: string[] | null;
  if (raw.collectionPaths === undefined || raw.collectionPaths === null) {
    collectionPaths = null;
  } else if (Array.isArray(raw.collectionPaths)
    && raw.collectionPaths.every((entry) => typeof entry === "string" && entry.length > 0)) {
    collectionPaths = raw.collectionPaths as string[];
  } else {
    throw new Error("Invalid library query");
  }

  const limit = raw.limit === undefined ? 500 : raw.limit;
  const offset = raw.offset === undefined ? 0 : raw.offset;
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 2000) {
    throw new Error("Invalid library query");
  }
  if (!Number.isSafeInteger(offset) || (offset as number) < 0) throw new Error("Invalid library query");

  const expectedBrowseRevision = raw.expectedBrowseRevision;
  if (expectedBrowseRevision !== undefined
    && (!Number.isSafeInteger(expectedBrowseRevision) || (expectedBrowseRevision as number) < 0)) {
    throw new Error("Invalid library query");
  }

  const archivePath = raw.archivePath === undefined || raw.archivePath === null
    ? null
    : typeof raw.archivePath === "string" && raw.archivePath.length > 0
      ? parseFilePath(raw.archivePath)
      : null;
  if (raw.archivePath !== undefined && raw.archivePath !== null && archivePath === null) {
    throw new Error("Invalid library query");
  }

  const query: LibraryQuery = {
    sort: sort as LibraryQuery["sort"],
    direction,
    extension,
    folder,
    search,
    collectionPaths,
    limit: limit as number,
    offset: offset as number,
    archivePath,
  };
  if (expectedBrowseRevision !== undefined) query.expectedBrowseRevision = expectedBrowseRevision as number;
  return query;
}

export function parseFileMetadataUpdate(value: unknown): UpdateFileMetadataData {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid file metadata update");
  }

  const raw = value as Partial<UpdateFileMetadataData>;
  if (typeof raw.id !== "number" || !Number.isFinite(raw.id)) {
    throw new Error("Invalid file metadata update");
  }

  if (
    raw.tags !== undefined &&
    raw.tags !== null &&
    (!Array.isArray(raw.tags) || raw.tags.some((tag) => typeof tag !== "string"))
  ) {
    throw new Error("Invalid file metadata update");
  }

  if (
    raw.notes !== undefined &&
    raw.notes !== null &&
    typeof raw.notes !== "string"
  ) {
    throw new Error("Invalid file metadata update");
  }

  return {
    id: Math.trunc(raw.id),
    tags:
      raw.tags === undefined
        ? undefined
        : raw.tags === null
          ? null
          : normalizeFileTags(raw.tags),
    notes: raw.notes === undefined ? undefined : raw.notes,
  };
}

export function resolveAndNormalizePath(value: string) {
  return path.resolve(value);
}
