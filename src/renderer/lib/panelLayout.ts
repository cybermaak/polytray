import {
  DEFAULT_PANEL_PREFERENCES,
  PANEL_PREFERENCE_BOUNDS,
} from "../../shared/panelPreferences";
export { normalizePanelPreferences } from "../../shared/panelPreferences";

export interface PanelLayoutInput {
  windowWidth: number;
  sidebarWidth: number;
  preferredPreviewWidth: number;
}

export interface PanelLayout {
  mode: "docked" | "overlay";
  browseWidth: number;
  previewWidth: number;
  sidebarWidth: number;
}

export const PANEL_LAYOUT_BOUNDS = {
  browseMinWidth: 400,
  previewMinWidth: PANEL_PREFERENCE_BOUNDS.previewMinWidth,
  previewPreferredWidth: DEFAULT_PANEL_PREFERENCES.previewWidth,
  sidebarMinWidth: PANEL_PREFERENCE_BOUNDS.sidebarMinWidth,
  sidebarMaxWidth: PANEL_PREFERENCE_BOUNDS.sidebarMaxWidth,
  previewMaxWidth: PANEL_PREFERENCE_BOUNDS.previewMaxWidth,
} as const;

export function calculatePanelLayout({
  windowWidth,
  sidebarWidth: preferredSidebarWidth,
  preferredPreviewWidth,
}: PanelLayoutInput): PanelLayout {
  const sidebarWidth = Math.min(
    Math.max(PANEL_LAYOUT_BOUNDS.sidebarMinWidth, preferredSidebarWidth),
    PANEL_LAYOUT_BOUNDS.sidebarMaxWidth,
    Math.max(PANEL_LAYOUT_BOUNDS.sidebarMinWidth, windowWidth - PANEL_LAYOUT_BOUNDS.browseMinWidth),
  );
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
    sidebarWidth,
  };
}
