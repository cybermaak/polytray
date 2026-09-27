export type MeasurementUnit = "mm" | "model-unit";
export type MeasurementStatus = "verified" | "unavailable";

export interface ModelMeasurement {
  version: 1;
  x: number | null;
  y: number | null;
  z: number | null;
  unit: MeasurementUnit;
  basis: "source-build";
  status: MeasurementStatus;
  reason?: "unsupported-structure" | "unknown-units" | "invalid-geometry" | "not-measured";
}

export interface MeasurementEnrichmentRequest {
  fileId: number;
  path: string;
  extension: string;
  contentRevision: number;
}
