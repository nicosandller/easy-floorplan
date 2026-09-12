import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // `*.browser.test.ts` needs a real browser (layout, a live CTM, pointer
    // capture) and runs under vitest.browser.config.ts — see CONTRIBUTING.md.
    exclude: [...configDefaults.exclude, "src/**/*.browser.test.ts"],
  },
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
