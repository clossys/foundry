import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/tokens.
 * Plain Node environment — the tests here parse this package's own CSS
 * files as text and compare them against src/tokens.ts; no DOM, no jsdom.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
