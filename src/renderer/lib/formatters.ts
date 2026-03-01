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
