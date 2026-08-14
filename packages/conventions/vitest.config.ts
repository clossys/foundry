import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/conventions.
 * Plain Node environment. The validators do zero I/O; only the self-hosting
 * test reads the package's own shipped documents, which needs no jsdom.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
