import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/icons.
 * jsdom, because several tests render real icon components (via
 * @testing-library/react) to check accessibility attributes and inline
 * sizing — unlike @vespeneventures/tokens, which only parses CSS as text.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 10_000,
    globals: false,
  },
});
