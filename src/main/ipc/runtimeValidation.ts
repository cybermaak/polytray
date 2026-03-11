import path from "path";
import {
  PreviewParseRequestData,
  RuntimeSettingsData,
  SortOptions,
} from "../../shared/types";
import { normalizeRuntimeSettings } from "../../shared/settings";

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
  if (
    !isNonEmptyString(request.requestId) ||
    !isNonEmptyString(request.filePath) ||
    !isNonEmptyString(request.ext)
  ) {
    throw new Error("Invalid preview parse request");
  }

  return {
    requestId: request.requestId,
    filePath: request.filePath,
    ext: request.ext,
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

export function resolveAndNormalizePath(value: string) {
  return path.resolve(value);
}
