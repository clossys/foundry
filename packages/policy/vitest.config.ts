import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/policy.
 * Plain Node environment — this package's own source does zero I/O (see
 * README's non-goal section); only its self-hosting test reads a real file
 * (its own LICENSE), and that needs no jsdom.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
