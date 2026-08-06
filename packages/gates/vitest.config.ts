import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/gates.
 * Plain Node environment — this package's own source does zero I/O of its
 * own (see README's non-goal section); its integration test reads the real
 * packages/ tree the same way catalog's own integration test does, and that
 * needs no jsdom.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
