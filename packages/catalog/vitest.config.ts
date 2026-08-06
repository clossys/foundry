import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/catalog.
 * Plain Node environment — this package reads the real filesystem (temp
 * fixture directories in tests, a real packages/ tree in the integration
 * test) but touches no DOM, so there is nothing jsdom would add.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
