import { renderThumbnail } from "./viewer.js";

/**
 * Initializes the thumbnail generator that listens for requests from the main process.
 * When a thumbnail request comes in, we render the 3D model on a hidden canvas
 * and send the result back.
 */
export function initThumbnailGenerator() {
  const canvas = document.getElementById("thumbnail-canvas");
  if (!canvas) return;

  window.polytray.onThumbnailRequest(async (data) => {
    const { filePath, ext, thumbPath } = data;

    try {
      // Read the file via IPC
      const buffer = await window.polytray.readFileBuffer(filePath);

      // Render thumbnail
      const dataUrl = await renderThumbnail(buffer, ext, canvas);

      if (dataUrl) {
        // Convert data URL to buffer and save via main process
        // We send the data URL back and let main process handle saving
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
}
