import { initThumbnailGenerator } from "./lib/thumbnailRenderer";

const canvas = document.getElementById("thumbnail-canvas") as HTMLCanvasElement;
if (canvas) {
  initThumbnailGenerator(canvas);
  console.log("[Thumbnail Worker] Generator initialized on hidden canvas");
} else {
  console.error("[Thumbnail Worker] Canvas element not found!");
}
