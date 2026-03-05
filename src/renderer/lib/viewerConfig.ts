/**
 * viewerConfig.ts — Shared configuration constants for the 3D viewer and thumbnail renderer.
 */

export const VIEWER_CONFIG = {
  camera: { fov: 45, near: 0.1, far: 10000, padding: 1.2 },
  exposure: 1.2,
  material: { color: 0x8888aa, metalness: 0.15, roughness: 0.6 },
  grid: {
    size: 20,
    divisions: 40,
    centerColor: 0x8a8b94,
    lineColor: 0x5c5d66,
    opacity: 0.4,
  },
  normalizeScale: 10.0,
  thumbnail: { size: 256 },
  lighting: {
    ambient: { color: 0x404050, intensity: 0.6 },
    hemisphere: { skyColor: 0x8888cc, groundColor: 0x443322, intensity: 0.5 },
    key: { color: 0xffffff, intensity: 1.2, position: [5, 8, 5] as const },
    fill: { color: 0x3b82f6, intensity: 0.4, position: [-3, 2, -3] as const },
    rim: { color: 0x3b82f6, intensity: 0.3, position: [0, -2, -5] as const },
  },
  thumbnailLighting: {
    ambient: { color: 0xffffff, intensity: 0.8 },
    hemisphere: { skyColor: 0xffffff, groundColor: 0x444444, intensity: 0.6 },
    key: { color: 0xffffff, intensity: 2.0, position: [5, 5, 5] as const },
    fill: { color: 0xffffff, intensity: 0.4, position: [-5, 0, -5] as const },
    rim: { color: 0xffffff, intensity: 0.6, position: [0, 5, -5] as const },
  },
  controls: {
    dampingFactor: 0.08,
    rotateSpeed: 0.8,
    zoomSpeed: 1.2,
    panSpeed: 0.8,
    minDistance: 0.1,
    maxDistance: 1000,
  },
} as const;
