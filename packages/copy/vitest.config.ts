import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/copy.
 * Plain Node environment. `types.ts` and `schema.ts` do zero I/O;
 * `checker.ts` does zero I/O either (it only calls `@vespeneventures/voice`'s
 * `checkCopy`, itself pure). `registry.ts` is this package's one deliberate
 * I/O surface, and its tests are hermetic for that reason: every fixture is
 * written to its own `mkdtemp` directory under the OS temp dir, never a real
 * path in this repository, and nothing here makes a network call.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
