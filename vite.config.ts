import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "easy-floorplan-card.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    // Bundle everything (incl. lit) into a single file so HA can load it as one resource.
    rollupOptions: {},
    minify: "esbuild",
    target: "es2021",
  },
});
