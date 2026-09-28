import React from "react";

export type PartThumbnailImages = ReadonlyMap<string, string>;
export type PartThumbnailImageAction = { id: string; url: string | null } | { clear: true };

export function reducePartThumbnailImages(
  current: PartThumbnailImages,
  action: PartThumbnailImageAction,
): Map<string, string> {
  if ("clear" in action) return new Map();
  const { id, url } = action;
  const next = new Map(current);
  if (url === null) {
    next.delete(id);
    return next;
  }
  next.delete(id);
  next.set(id, url);
  while (next.size > 64) next.delete(next.keys().next().value as string);
  return next;
}

export const PartThumbnailImage: React.FC<{ url?: string; index: number }> = ({ url, index }) => (
  url
    ? <img src={url} alt="" data-part-thumbnail="ready" />
    : <span className="archive-thumb-fallback" data-part-thumbnail="placeholder">{index + 1}</span>
);
