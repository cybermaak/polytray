import { initPreviewParseRenderer } from './lib/previewParseRenderer';

const cleanup = initPreviewParseRenderer();
window.addEventListener('pagehide', cleanup, { once: true });
