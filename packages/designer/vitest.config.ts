import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/designer.
 * jsdom, because these tests render real React components and drive them
 * with @testing-library/react's queries and keyboard/pointer events —
 * unlike the token layer, which only parses CSS as text.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
