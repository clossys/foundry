import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/copy.
 * Plain Node environment. `scan.test.ts` and `cli.test.ts` do real
 * filesystem I/O, but only against a per-test `mkdtemp` temp directory (see
 * those files' own setup) — never a real repository path — so this stays
 * hermetic without any special config.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
