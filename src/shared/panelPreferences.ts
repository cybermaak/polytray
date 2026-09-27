export const DEFAULT_PANEL_PREFERENCES = {
  sidebarWidth: 260,
  previewWidth: 360,
} as const;

export const PANEL_PREFERENCE_BOUNDS = {
  sidebarMinWidth: 200,
  sidebarMaxWidth: 600,
  previewMinWidth: 320,
  previewMaxWidth: 900,
} as const;

function normalizeWidth(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function normalizePanelPreferences(input: {
  sidebarWidth?: unknown;
  previewWidth?: unknown;
}) {
  return {
    sidebarWidth: normalizeWidth(
      input.sidebarWidth,
      DEFAULT_PANEL_PREFERENCES.sidebarWidth,
      PANEL_PREFERENCE_BOUNDS.sidebarMinWidth,
      PANEL_PREFERENCE_BOUNDS.sidebarMaxWidth,
    ),
    previewWidth: normalizeWidth(
      input.previewWidth,
      DEFAULT_PANEL_PREFERENCES.previewWidth,
      PANEL_PREFERENCE_BOUNDS.previewMinWidth,
      PANEL_PREFERENCE_BOUNDS.previewMaxWidth,
    ),
  };
}
