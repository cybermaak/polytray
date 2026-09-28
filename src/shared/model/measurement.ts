export const MEASUREMENT_VERSION = 1 as const;

export type MeasurementUnit = 'mm' | 'model-unit';

export interface AvailableMeasurement {
  version: typeof MEASUREMENT_VERSION;
  x: number;
  y: number;
  z: number;
  unit: MeasurementUnit;
  basis: 'source-build';
  status: 'available';
}

export interface UnavailableMeasurement {
  version: typeof MEASUREMENT_VERSION;
  x: null;
  y: null;
  z: null;
  unit: MeasurementUnit;
  basis: 'source-build';
  status: 'unavailable';
  reason: string;
}

export type Measurement = AvailableMeasurement | UnavailableMeasurement;

export interface LegacyDimensions {
  x: number;
  y: number;
  z: number;
}

export type StoredMeasurement = Measurement | LegacyDimensions;

export type MeasurementPresentation =
  | { status: 'available'; x: number; y: number; z: number; unit: MeasurementUnit }
  | { status: 'unavailable'; reason: string };

export function createAvailableMeasurement(
  dimensions: LegacyDimensions,
  unit: MeasurementUnit,
): AvailableMeasurement | null {
  if (![dimensions.x, dimensions.y, dimensions.z].every((value) => Number.isFinite(value) && value >= 0)) return null;
  return { version: MEASUREMENT_VERSION, ...dimensions, unit, basis: 'source-build', status: 'available' };
}

export function createUnavailableMeasurement(unit: MeasurementUnit, reason: string): UnavailableMeasurement {
  return {
    version: MEASUREMENT_VERSION,
    x: null,
    y: null,
    z: null,
    unit,
    basis: 'source-build',
    status: 'unavailable',
    reason: reason.trim() || 'Measurement unavailable',
  };
}

export function isCurrentMeasurement(value: unknown): value is Measurement {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Measurement>;
  if (candidate.version !== MEASUREMENT_VERSION || candidate.basis !== 'source-build') return false;
  if (candidate.unit !== 'mm' && candidate.unit !== 'model-unit') return false;
  if (candidate.status === 'available') {
    return [candidate.x, candidate.y, candidate.z].every((axis) => typeof axis === 'number' && Number.isFinite(axis) && axis >= 0);
  }
  return candidate.status === 'unavailable'
    && candidate.x === null && candidate.y === null && candidate.z === null
    && typeof candidate.reason === 'string' && candidate.reason.trim().length > 0;
}

/** Legacy x/y/z JSON has no trustworthy unit or source-build provenance. */
export function legacyMeasurementToUnavailable(_value: LegacyDimensions): UnavailableMeasurement {
  return createUnavailableMeasurement('model-unit', 'Legacy dimensions have unverified units and provenance');
}

/** Pure U06-facing shape: legacy bare values are never presented as verified. */
export function toMeasurementPresentation(value: StoredMeasurement | null | undefined): MeasurementPresentation {
  if (!value) return { status: 'unavailable', reason: 'Measurement is not available' };
  if (isCurrentMeasurement(value)) {
    return value.status === 'available'
      ? { status: 'available', x: value.x, y: value.y, z: value.z, unit: value.unit }
      : { status: 'unavailable', reason: value.reason };
  }
  return { status: 'unavailable', reason: 'Legacy dimensions have unverified units and provenance' };
}

export function parseStoredMeasurement(value: string | null | undefined): StoredMeasurement | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (isCurrentMeasurement(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      const dimensions = parsed as Partial<LegacyDimensions>;
      if ([dimensions.x, dimensions.y, dimensions.z].every((axis) => typeof axis === 'number' && Number.isFinite(axis) && axis >= 0)) {
        return { x: dimensions.x!, y: dimensions.y!, z: dimensions.z! };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function hasCurrentStoredMeasurement(value: string | null | undefined): boolean {
  if (!value) return false;
  try { return isCurrentMeasurement(JSON.parse(value) as unknown); }
  catch { return false; }
}
