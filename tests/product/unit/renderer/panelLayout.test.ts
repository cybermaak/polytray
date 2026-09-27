import test from "node:test";
import assert from "node:assert/strict";
import {
  calculatePanelLayout,
  normalizePanelPreferences,
} from "../../../../src/renderer/lib/panelLayout";

test("panel layout keeps at least 400px for browsing when the preferred preview fits", () => {
  assert.deepEqual(
      calculatePanelLayout({ windowWidth: 1280, sidebarWidth: 260, preferredPreviewWidth: 360 }),
      { mode: "docked", browseWidth: 660, previewWidth: 360, sidebarWidth: 260 },
    );
});

test("panel layout uses a content overlay when minimum dock widths do not fit", () => {
  assert.deepEqual(
      calculatePanelLayout({ windowWidth: 900, sidebarWidth: 260, preferredPreviewWidth: 360 }),
      { mode: "overlay", browseWidth: 640, previewWidth: 360, sidebarWidth: 260 },
    );
});

test("panel layout clamps docked preview without changing preference", () => {
  assert.deepEqual(calculatePanelLayout({ windowWidth: 1100, sidebarWidth: 300, preferredPreviewWidth: 700 }),
    { mode: "docked", browseWidth: 400, previewWidth: 400, sidebarWidth: 300 });
});

test("panel layout supports the target window widths and maximum saved preview size", () => {
  assert.deepEqual(calculatePanelLayout({ windowWidth: 1920, sidebarWidth: 260, preferredPreviewWidth: 900 }),
    { mode: "docked", browseWidth: 760, previewWidth: 900, sidebarWidth: 260 });
  assert.deepEqual(calculatePanelLayout({ windowWidth: 900, sidebarWidth: 600, preferredPreviewWidth: 900 }),
    { mode: "overlay", browseWidth: 400, previewWidth: 400, sidebarWidth: 500 });
});

test("panel preferences are normalized independently of temporary window clamps", () => {
  assert.deepEqual(normalizePanelPreferences({ sidebarWidth: 260, previewWidth: 700 }),
    { sidebarWidth: 260, previewWidth: 700 });
  assert.deepEqual(normalizePanelPreferences({ sidebarWidth: 20, previewWidth: 5000 }),
    { sidebarWidth: 200, previewWidth: 900 });
});
