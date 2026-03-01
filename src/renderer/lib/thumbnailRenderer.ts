import { renderThumbnail } from "./viewer";

/**
 * Initializes the thumbnail generator that listens for requests from the main process.
 * When a thumbnail request comes in, we render the 3D model on a hidden canvas
 * and send the result back.
 */
export function initThumbnailGenerator(canvas: HTMLCanvasElement) {
  const cleanup = window.polytray.onThumbnailRequest(async (data) => {
    const { filePath, ext, thumbPath } = data;

    try {
      const buffer = await window.polytray.readFileBuffer(filePath);

      const dataUrl = await renderThumbnail(buffer, ext, canvas);

      if (dataUrl) {
        window.polytray.sendThumbnailResult({
          filePath,
          thumbPath,
          success: true,
          dataUrl,
        });
      } else {
        window.polytray.sendThumbnailResult({
          filePath,
          thumbPath,
          success: false,
        });
      }
    } catch (e) {
      console.warn("Thumbnail generation failed for", filePath, e);
      window.polytray.sendThumbnailResult({
        filePath,
        thumbPath,
        success: false,
      });
    }
  });

  return cleanup;
}
