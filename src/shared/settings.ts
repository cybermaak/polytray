export const SETTINGS_STORAGE_KEY = "polytray-settings";

export type GridSize = "small" | "medium" | "large";
export type ThumbnailQuality = "128" | "256" | "512";

export interface AppSettings {
  lightMode: boolean;
  gridSize: GridSize;
  autoScan: boolean;
  watch: boolean;
  showGrid: boolean;
  thumbQuality: ThumbnailQuality;
  accentColor: string;
  thumbnail_timeout: number;
  scanning_batch_size: number;
  watcher_stability: number;
  page_size: number;
}

export interface RuntimeSettings {
  thumbnail_timeout: number;
  scanning_batch_size: number;
  watcher_stability: number;
  page_size: number;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  lightMode: false,
  gridSize: "medium",
  autoScan: true,
  watch: true,
  showGrid: true,
  thumbQuality: "256",
  accentColor: "#6d9fff",
  thumbnail_timeout: 20000,
  scanning_batch_size: 50,
  watcher_stability: 1000,
  page_size: 500,
};

const THUMB_QUALITIES: ThumbnailQuality[] = ["128", "256", "512"];
const GRID_SIZES: GridSize[] = ["small", "medium", "large"];

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.round(value);
  if (rounded < min || rounded > max) {
    return fallback;
  }

  return rounded;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeHexColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value
    : fallback;
}

function normalizeChoice<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
) {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

export function normalizeAppSettings(input: unknown): AppSettings {
  const raw =
    input && typeof input === "object"
      ? (input as Partial<Record<keyof AppSettings, unknown>>)
      : {};

  return {
    lightMode: normalizeBoolean(
      raw.lightMode,
      DEFAULT_APP_SETTINGS.lightMode,
    ),
    gridSize: normalizeChoice(
      raw.gridSize,
      GRID_SIZES,
      DEFAULT_APP_SETTINGS.gridSize,
    ),
    autoScan: normalizeBoolean(
      raw.autoScan,
      DEFAULT_APP_SETTINGS.autoScan,
    ),
    watch: normalizeBoolean(raw.watch, DEFAULT_APP_SETTINGS.watch),
    showGrid: normalizeBoolean(
      raw.showGrid,
      DEFAULT_APP_SETTINGS.showGrid,
    ),
    thumbQuality: normalizeChoice(
      raw.thumbQuality,
      THUMB_QUALITIES,
      DEFAULT_APP_SETTINGS.thumbQuality,
    ),
    accentColor: normalizeHexColor(
      raw.accentColor,
      DEFAULT_APP_SETTINGS.accentColor,
    ),
    thumbnail_timeout: clampInteger(
      raw.thumbnail_timeout,
      DEFAULT_APP_SETTINGS.thumbnail_timeout,
      1000,
      120000,
    ),
    scanning_batch_size: clampInteger(
      raw.scanning_batch_size,
      DEFAULT_APP_SETTINGS.scanning_batch_size,
      1,
      500,
    ),
    watcher_stability: clampInteger(
      raw.watcher_stability,
      DEFAULT_APP_SETTINGS.watcher_stability,
      50,
      10000,
    ),
    page_size: clampInteger(
      raw.page_size,
      DEFAULT_APP_SETTINGS.page_size,
      50,
      2000,
    ),
  };
}

export function serializeAppSettings(input: unknown) {
  return JSON.stringify(normalizeAppSettings(input));
}

export function toRuntimeSettings(settings: AppSettings): RuntimeSettings {
  return {
    thumbnail_timeout: settings.thumbnail_timeout,
    scanning_batch_size: settings.scanning_batch_size,
    watcher_stability: settings.watcher_stability,
    page_size: settings.page_size,
  };
}
