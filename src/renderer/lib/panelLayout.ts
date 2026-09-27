export interface PanelLayoutInput {
  windowWidth: number;
  sidebarWidth: number;
  preferredPreviewWidth: number;
}

export interface PanelLayout {
  mode: "docked" | "overlay";
  browseWidth: number;
  previewWidth: number;
}

export const PANEL_LAYOUT_BOUNDS = {
  browseMinWidth: 400,
  previewMinWidth: 320,
  previewPreferredWidth: 360,
  sidebarMinWidth: 200,
  sidebarMaxWidth: 600,
  previewMaxWidth: 900,
} as const;

export function calculatePanelLayout({
  windowWidth,
  sidebarWidth,
  preferredPreviewWidth,
}: PanelLayoutInput): PanelLayout {
  const contentWidth = Math.max(0, windowWidth - sidebarWidth);
  const canDock = windowWidth >= sidebarWidth + PANEL_LAYOUT_BOUNDS.browseMinWidth + PANEL_LAYOUT_BOUNDS.previewMinWidth;
  const previewWidth = Math.min(
    Math.max(PANEL_LAYOUT_BOUNDS.previewMinWidth, preferredPreviewWidth),
    PANEL_LAYOUT_BOUNDS.previewMaxWidth,
    canDock
      ? contentWidth - PANEL_LAYOUT_BOUNDS.browseMinWidth
      : contentWidth,
  );

  return {
    mode: canDock ? "docked" : "overlay",
    browseWidth: canDock ? contentWidth - previewWidth : contentWidth,
    previewWidth,
  };
}

export function normalizePanelPreferences(preferences: {
  sidebarWidth: number;
  previewWidth: number;
}) {
  const normalize = (value: number, fallback: number, min: number, max: number) =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
  return {
    sidebarWidth: normalize(preferences.sidebarWidth, 260, PANEL_LAYOUT_BOUNDS.sidebarMinWidth, PANEL_LAYOUT_BOUNDS.sidebarMaxWidth),
    previewWidth: normalize(preferences.previewWidth, PANEL_LAYOUT_BOUNDS.previewPreferredWidth, PANEL_LAYOUT_BOUNDS.previewMinWidth, PANEL_LAYOUT_BOUNDS.previewMaxWidth),
  };
}
