import { useEffect, useRef, type RefObject } from "react";

const overlayOrder: symbol[] = [];
const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled])", "select:not([disabled])",
  "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((element) => !element.closest("[inert]") && element.getClientRects().length > 0);
}

export function useOverlayFocus(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
): void {
  const overlayId = useRef(Symbol("overlay"));
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;
    const id = overlayId.current;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlayOrder.push(id);
    container.setAttribute("data-focus-overlay", "true");

    const focusFirst = () => {
      if (overlayOrder[overlayOrder.length - 1] !== id) return;
      const first = getFocusable(container)[0];
      (first ?? container).focus();
    };
    requestAnimationFrame(focusFirst);

    const onKeyDown = (event: KeyboardEvent) => {
      if (overlayOrder[overlayOrder.length - 1] !== id) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        escapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable(container);
      if (!focusable.length) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (overlayOrder[overlayOrder.length - 1] !== id || container.contains(event.target as Node)) return;
      focusFirst();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      container.removeAttribute("data-focus-overlay");
      const index = overlayOrder.indexOf(id);
      if (index >= 0) overlayOrder.splice(index, 1);
      requestAnimationFrame(() => {
        if (returnFocus?.isConnected) returnFocus.focus();
      });
    };
  }, [active, containerRef]);
}
