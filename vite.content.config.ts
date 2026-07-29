import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/content/content-script.ts"),
      name: "WebFileHunterContent",
      formats: ["iife"],
      fileName: () => "content-script.js"
    }
  }
});
