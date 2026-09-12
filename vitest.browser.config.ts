import { defineConfig } from "vitest/config";

/**
 * The browser suite: tests that need real layout, a live `getScreenCTM()`,
 * and real pointer capture. jsdom has none of these and happy-dom fakes them
 * (an identity CTM, zero layout), which lets a regression test pass against
 * the very bug it was written for — so these run in Chromium, via Playwright.
 *
 * Kept out of `npm test` on purpose: the node suite stays fast, and this one
 * is opt-in (`npm run test:browser`). See CONTRIBUTING.md.
 */
export default defineConfig({
  test: {
    name: "browser",
    include: ["src/**/*.browser.test.ts"],
    browser: {
      enabled: true,
      provider: "playwright",
      name: "chromium",
      headless: true,
      screenshotFailures: false,
    },
  },
});
