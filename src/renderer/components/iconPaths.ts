export type IconShape =
  | {
      kind: "path";
      d: string;
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
      strokeLinecap?: "round" | "square" | "butt";
      strokeLinejoin?: "round" | "miter" | "bevel";
    }
  | {
      kind: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke?: string;
      strokeWidth?: number;
      strokeLinecap?: "round" | "square" | "butt";
    }
  | {
      kind: "circle";
      cx: number;
      cy: number;
      r: number;
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
    }
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      rx?: number;
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
    }
  | {
      kind: "polyline";
      points: string;
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
      strokeLinecap?: "round" | "square" | "butt";
      strokeLinejoin?: "round" | "miter" | "bevel";
    };

export const ICON_PATHS: Record<string, IconShape[]> = {
  settings: [
    {
      kind: "path",
      d: "M6.95 2.35h2.1l.34 1.42c.39.1.76.26 1.1.46l1.27-.72 1.48 1.48-.72 1.27c.2.34.36.71.46 1.1l1.42.34v2.1l-1.42.34c-.1.39-.26.76-.46 1.1l.72 1.27-1.48 1.48-1.27-.72c-.34.2-.71.36-1.1.46l-.34 1.42h-2.1l-.34-1.42a4.38 4.38 0 01-1.1-.46l-1.27.72-1.48-1.48.72-1.27a4.38 4.38 0 01-.46-1.1l-1.42-.34v-2.1l1.42-.34c.1-.39.26-.76.46-1.1l-.72-1.27L4.62 3.5l1.27.72c.34-.2.71-.36 1.1-.46l.34-1.42z",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.15,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    {
      kind: "circle",
      cx: 8,
      cy: 8,
      r: 2.05,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.15,
    },
  ],
  theme: [
    {
      kind: "circle",
      cx: 8,
      cy: 8,
      r: 3.2,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.4,
    },
    { kind: "line", x1: 8, y1: 1.2, x2: 8, y2: 3, stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" },
    { kind: "line", x1: 8, y1: 13, x2: 8, y2: 14.8, stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" },
    { kind: "line", x1: 1.2, y1: 8, x2: 3, y2: 8, stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" },
    { kind: "line", x1: 13, y1: 8, x2: 14.8, y2: 8, stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" },
    { kind: "line", x1: 3.2, y1: 3.2, x2: 4.45, y2: 4.45, stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" },
    { kind: "line", x1: 11.55, y1: 11.55, x2: 12.8, y2: 12.8, stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" },
    { kind: "line", x1: 3.2, y1: 12.8, x2: 4.45, y2: 11.55, stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" },
    { kind: "line", x1: 11.55, y1: 4.45, x2: 12.8, y2: 3.2, stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" },
  ],
  sortOrder: [
    { kind: "line", x1: 5, y1: 2.5, x2: 5, y2: 13.5, stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" },
    { kind: "polyline", points: "2.8 10.8 5 13.2 7.2 10.8", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" },
    { kind: "line", x1: 11, y1: 13.5, x2: 11, y2: 2.5, stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" },
    { kind: "polyline", points: "8.8 5.2 11 2.8 13.2 5.2", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" },
  ],
  rescan: [
    {
      kind: "path",
      d: "M13.1 5.9A5.4 5.4 0 003.65 4.2",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.45,
      strokeLinecap: "round",
    },
    {
      kind: "path",
      d: "M2.9 10.1A5.4 5.4 0 0012.35 11.8",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.45,
      strokeLinecap: "round",
    },
    {
      kind: "polyline",
      points: "10.9 3.6 13.5 3.6 13.5 6.2",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.45,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    {
      kind: "polyline",
      points: "5.1 12.4 2.5 12.4 2.5 9.8",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.45,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
  ],
  thumbnailRefresh: [
    {
      kind: "rect",
      x: 2,
      y: 3,
      width: 12,
      height: 9,
      rx: 1.4,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.35,
    },
    { kind: "circle", cx: 5.15, cy: 6.15, r: 0.95, fill: "currentColor" },
    {
      kind: "path",
      d: "M3.2 10.1l2.45-2.3 1.95 1.65 2.3-2.9 2.1 3.54",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.35,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    {
      kind: "path",
      d: "M10.9 13.25a2.35 2.35 0 002.25-2.32",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.2,
      strokeLinecap: "round",
    },
    {
      kind: "polyline",
      points: "11.65 9.35 13.15 10.9 14.55 9.35",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
  ],
  wireframe: [
    {
      kind: "path",
      d: "M8 2.2l4.8 2.75v5.55L8 13.8 3.2 10.5V4.95L8 2.2z",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.35,
      strokeLinejoin: "round",
    },
    { kind: "line", x1: 8, y1: 2.2, x2: 8, y2: 13.8, stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" },
    { kind: "line", x1: 3.2, y1: 4.95, x2: 8, y2: 7.7, stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" },
    { kind: "line", x1: 12.8, y1: 4.95, x2: 8, y2: 7.7, stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" },
  ],
  preview: [
    { kind: "circle", cx: 8, cy: 8, r: 4.8, fill: "none", stroke: "currentColor", strokeWidth: 1.3 },
    { kind: "circle", cx: 8, cy: 8, r: 1.7, fill: "none", stroke: "currentColor", strokeWidth: 1.3 },
    { kind: "line", x1: 8, y1: 1.5, x2: 8, y2: 3.2, stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" },
    { kind: "line", x1: 8, y1: 12.8, x2: 8, y2: 14.5, stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" },
    { kind: "line", x1: 1.5, y1: 8, x2: 3.2, y2: 8, stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" },
    { kind: "line", x1: 12.8, y1: 8, x2: 14.5, y2: 8, stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" },
  ],
  expand: [
    { kind: "polyline", points: "9.5 2.5 13.5 2.5 13.5 6.5", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" },
    { kind: "line", x1: 13.5, y1: 2.5, x2: 8.8, y2: 7.2, stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" },
    { kind: "polyline", points: "6.5 13.5 2.5 13.5 2.5 9.5", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" },
    { kind: "line", x1: 2.5, y1: 13.5, x2: 7.2, y2: 8.8, stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" },
  ],
  close: [
    { kind: "line", x1: 4, y1: 4, x2: 12, y2: 12, stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" },
    { kind: "line", x1: 12, y1: 4, x2: 4, y2: 12, stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" },
  ],
};
