import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ["better-sqlite3"],
        input: {
          index: "./src/main/index.ts",
          worker: "./src/main/worker.ts",
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: "./src/renderer/index.html",
          thumbnail: "./src/renderer/thumbnail.html",
        },
      },
    },
  },
});
