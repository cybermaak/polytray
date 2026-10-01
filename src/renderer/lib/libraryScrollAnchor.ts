export interface LibraryScrollAnchor {
  itemKey: string;
  itemIndex: number;
  columns: number;
  rowStep: number;
  scrollTop: number;
}

/**
 * Decides whether a library refresh may record a new scroll anchor.
 *
 * A captured anchor is restored after its refresh settles, one animation frame later. Until then
 * the DOM still shows the un-restored position (new rows inserted above the viewport, scroll not
 * yet corrected), so a capture in that window would measure the wrong card and drop the pending
 * correction. Keep the pending anchor until it has been restored.
 */
export function shouldCaptureLibraryScrollAnchor(state: {
  hasPendingAnchor: boolean;
  refreshing: boolean;
  restoreFramePending: boolean;
}): boolean {
  if (!state.hasPendingAnchor) return true;
  // A pending anchor with no refresh in flight and no restore scheduled is stale (for example its
  // refresh was skipped), so a fresh capture is correct.
  return !state.refreshing && !state.restoreFramePending;
}

/**
 * Keeps anchoring to the card restored last time while the user has not scrolled since.
 *
 * Choosing "the first card in the top visible row" afresh on every refresh drifts during a
 * streaming scan: once inserted rows share the top row with the cards the user was reading, the
 * next refresh anchors to an inserted card, and later inserts after it push the original cards out
 * of view. Returns null when the user has scrolled or the card is gone, so the caller captures anew.
 */
export function reuseRestoredLibraryScrollAnchor(
  lastRestored: LibraryScrollAnchor | null,
  scrollTop: number,
  currentIndex: number,
): LibraryScrollAnchor | null {
  if (!lastRestored || currentIndex < 0 || Math.abs(scrollTop - lastRestored.scrollTop) > 1) return null;
  return { ...lastRestored, itemIndex: currentIndex, scrollTop };
}

/** Scroll position that keeps the anchor card's row where it was, given its index after a refresh. */
export function libraryScrollRestoreTarget(anchor: LibraryScrollAnchor, currentIndex: number): number {
  if (currentIndex < 0 || anchor.itemIndex < 0) return anchor.scrollTop;
  const rowDelta = Math.floor(currentIndex / anchor.columns) - Math.floor(anchor.itemIndex / anchor.columns);
  return Math.max(0, anchor.scrollTop + rowDelta * anchor.rowStep);
}
