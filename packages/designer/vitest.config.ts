import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @clossys/designer.
 * jsdom, because these tests render real React components and drive them
 * with @testing-library/react's queries and keyboard/pointer events —
 * unlike the token layer, which only parses CSS as text.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    // Builds dist/ once, before any test file runs; test files never rebuild it (#1385).
    globalSetup: ["../../scripts/lib/vitest-build-package.mjs"],
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
