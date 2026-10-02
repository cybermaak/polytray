import { test } from '@playwright/test';
import type { Page } from 'playwright';
import fs from 'node:fs/promises';

/** Best-effort diagnostics for virtualized cards; never replace the caller's assertion error. */
export async function attachGridFailureEvidence(page: Page, label: string, targetSelector?: string) {
  let probeTimer: NodeJS.Timeout | undefined;
  let writeTimer: NodeJS.Timeout | undefined;
  let attachTimer: NodeJS.Timeout | undefined;
  try {
    const evidence = await Promise.race([
      page.evaluate((selector) => {
        const scroller = document.querySelector<HTMLElement>('[data-virtuoso-scroller]');
        const grid = document.querySelector<HTMLElement>('#file-grid');
        const bounds = scroller?.getBoundingClientRect();
        const mounted = [...(grid?.querySelectorAll<HTMLElement>('[data-item-key]') ?? [])];
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          scroller: scroller && bounds ? {
            scrollTop: scroller.scrollTop,
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
            top: bounds.top,
            bottom: bounds.bottom,
          } : null,
          grid: grid ? {
            ariaLabel: grid.getAttribute('aria-label'),
            rovingKey: grid.dataset.rovingKey,
            columns: getComputedStyle(grid).gridTemplateColumns,
            mounted: mounted.map(card => {
              const rect = card.getBoundingClientRect();
              return {
                key: card.dataset.itemKey,
                name: card.querySelector<HTMLElement>('.card-name')?.title ?? null,
                top: rect.top,
                bottom: rect.bottom,
                visibleInScroller: Boolean(bounds && rect.bottom > bounds.top && rect.top < bounds.bottom),
              };
            }),
          } : null,
          target: selector ? { selector, mountedCount: document.querySelectorAll(selector).length } : null,
          resultTotal: document.querySelector('#library-result-total')?.textContent ?? null,
          pageStatus: document.querySelector('.library-page-empty-status')?.textContent ?? null,
          footer: document.querySelector('.library-page-footer')?.textContent ?? null,
          previewClass: document.querySelector('#preview-panel')?.className ?? null,
          activeElement: (document.activeElement as HTMLElement | null)?.outerHTML.slice(0, 300) ?? null,
        };
      }, targetSelector).catch(error => ({ probeError: String(error) })),
      new Promise<{ probeTimedOut: true }>(resolve => { probeTimer = setTimeout(() => resolve({ probeTimedOut: true }), 5000); }),
    ]);
    const outputPath = test.info().outputPath(`${label}-grid-state.json`);
    await Promise.race([
      fs.writeFile(outputPath, JSON.stringify(evidence, null, 2)),
      new Promise<void>(resolve => { writeTimer = setTimeout(resolve, 2000); }),
    ]);
    await Promise.race([
      test.info().attach(`${label}-grid-state.json`, { path: outputPath, contentType: 'application/json' }),
      new Promise<void>(resolve => { attachTimer = setTimeout(resolve, 2000); }),
    ]);
  } catch { /* Preserve the caller's original failure. */ }
  finally {
    if (probeTimer) clearTimeout(probeTimer);
    if (writeTimer) clearTimeout(writeTimer);
    if (attachTimer) clearTimeout(attachTimer);
  }
}
