import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/assets. Plain Node
 * environment. `types.ts`, `schema.ts`, and `coverage.ts` do zero I/O;
 * `registry.ts` is this package's one deliberate I/O surface, and its
 * tests are hermetic for that reason: every fixture is written to its own
 * `mkdtemp` directory under the OS temp dir, never a real path in this
 * repository, and nothing here makes a network call.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
