export type GridNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown";

export function getGridColumnCount(template: string): number {
  const tracks = template.trim().match(/(?:\([^)]*\)|[^\s])+/g) ?? [];
  return Math.max(1, tracks.length);
}

export function sameGridKeys(previousKeys: readonly string[], nextKeys: readonly string[]): boolean {
  return previousKeys.length === nextKeys.length && previousKeys.every((key, index) => key === nextKeys[index]);
}

export function getGridTabStopKey(rovingKey: string | null, renderedKeys: readonly string[]): string | null {
  if (!renderedKeys.length) return null;
  return rovingKey && renderedKeys.includes(rovingKey) ? rovingKey : renderedKeys[0];
}

export function getGridMoveDelta(key: GridNavigationKey, columns: number, pageSize = columns): number {
  const columnCount = Math.max(1, columns);
  return key === "ArrowLeft" ? -1
    : key === "ArrowRight" ? 1
      : key === "ArrowUp" ? -columnCount
        : key === "ArrowDown" ? columnCount
          : key === "PageUp" ? -Math.max(columnCount, pageSize)
            : key === "PageDown" ? Math.max(columnCount, pageSize)
              : 0;
}

export function getGridPageEdgeTarget(
  index: number,
  itemCount: number,
  columns: number,
  key: GridNavigationKey,
  pageSize: number,
  hasMore: boolean,
): number | null {
  if (!hasMore || (key !== "ArrowDown" && key !== "PageDown")) return null;
  const requestedIndex = index + getGridMoveDelta(key, columns, pageSize);
  return requestedIndex >= itemCount ? requestedIndex : null;
}

export function getGridMoveIndex(
  index: number,
  itemCount: number,
  columns: number,
  key: GridNavigationKey,
  pageSize = columns,
): number {
  if (itemCount <= 0) return -1;
  const last = itemCount - 1;
  const safeIndex = Math.max(0, Math.min(index, last));
  const columnCount = Math.max(1, columns);
  if (key === "Home") return 0;
  if (key === "End") return last;
  return Math.max(0, Math.min(safeIndex + getGridMoveDelta(key, columnCount, pageSize), last));
}

export function reconcileGridFocus(
  previousKeys: readonly string[],
  nextKeys: readonly string[],
  focusedKey: string | null,
): { key: string | null; index: number } {
  if (!nextKeys.length) return { key: null, index: -1 };
  const retainedIndex = focusedKey === null ? -1 : nextKeys.indexOf(focusedKey);
  if (retainedIndex >= 0) return { key: nextKeys[retainedIndex], index: retainedIndex };
  const previousIndex = focusedKey === null ? 0 : previousKeys.indexOf(focusedKey);
  const index = Math.min(Math.max(0, previousIndex), nextKeys.length - 1);
  return { key: nextKeys[index], index };
}
