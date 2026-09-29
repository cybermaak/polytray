/**
 * formatters.ts — Shared formatting utilities.
 */

export function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

export function formatNumber(n: number): string {
  if (!n) return "0";
  return n.toLocaleString();
}

export function formatVertices(count: number): string {
  if (!count) return "—";
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + "M verts";
  if (count >= 1_000) return (count / 1_000).toFixed(1) + "K verts";
  return count.toString() + " verts";
}

export function formatTimestamp(epochMs: number): string {
  if (!epochMs) return "";
  const d = new Date(epochMs);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;

  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDimensions(dimensions: {
  x: number;
  y: number;
  z: number;
} | null): string {
  if (!dimensions) return "—";
  const formatAxis = (value: number) => {
    if (!Number.isFinite(value)) return "0";
    return Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/\.?0+$/, "");
  };

  return `${formatAxis(dimensions.x)} × ${formatAxis(dimensions.y)} × ${formatAxis(dimensions.z)}`;
}

/** Presents persisted dimensions without implying physical units for legacy data. */
export function formatMeasurement(serialized: string | null | undefined): string {
  if (!serialized) return "Unavailable";
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return "Unavailable: measurement data is invalid";
  }
  if (!value || typeof value !== "object") return "Unavailable: measurement data is invalid";
  const measurement = value as Record<string, unknown>;
  if (measurement.status === "unavailable") {
    const reason = typeof measurement.reason === "string" ? measurement.reason.trim() : "";
    return reason ? `Unavailable: ${reason}` : "Unavailable";
  }
  const axes = [measurement.x, measurement.y, measurement.z];
  if (!axes.every(axis => typeof axis === "number" && Number.isFinite(axis) && axis >= 0)) {
    return "Unavailable: measurement data is invalid";
  }
  const dimensions = formatDimensions({ x: axes[0] as number, y: axes[1] as number, z: axes[2] as number });
  const verified = measurement.version === 1 && measurement.basis === "source-build"
    && (measurement.status === "available" || measurement.status === "verified")
    && (measurement.unit === "mm" || measurement.unit === "model-unit");
  if (!verified) return `${dimensions} (unverified units)`;
  if (measurement.unit === "mm") return `${dimensions} mm (verified source build)`;
  return `${dimensions} model units`;
}
