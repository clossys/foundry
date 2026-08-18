import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/governance.
 * This package is a deprecated compatibility stub (see issue #282): its
 * source has moved to @vespeneventures/controller and every subpath here
 * re-exports the matching controller subpath. Plain Node environment,
 * matching every sibling package in this repository.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
