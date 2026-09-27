import type { SerializedMesh } from "./types";

export interface PreviewParseRequest {
  requestId: string;
  path: string;
  extension: string;
  contentRevision: number;
}

export interface PreviewParseCancelRequest {
  requestId: string;
  reason: "replaced" | "user" | "disposed" | "timeout";
}

export type PreviewParsePortMessage =
  | { requestId: string; type: "done"; preview: PreparedPreview }
  | { requestId: string; type: "error"; error: string }
  | { requestId: string; type: "cancelled"; reason: string };

/** Renderer strategy API; AbortSignal never crosses IPC. */
export interface PreviewParseStrategyClient {
  requestPreviewParse(request: PreviewParseRequest, signal: AbortSignal): Promise<PreparedPreview>;
}

/** IPC/preload transport API. The request ID is the cancellation identity. */
export interface PreviewParseTransportClient {
  requestPreviewParse(request: PreviewParseRequest): Promise<PreparedPreview>;
  cancelPreviewParse(requestId: string): void;
}

export type PreviewOrientationTransform = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export interface PreparedPreview {
  meshes: SerializedMesh[];
  orientation: PreviewOrientationTransform;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  measurements?: import("./measurementContracts").ModelMeasurement;
}
