import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/strategist.
 * Plain Node environment — nothing here needs jsdom. `reader.test.ts` and
 * `scan.test.ts` do real filesystem I/O, but only against a per-test
 * `mkdtemp` temp directory (see those files' own setup) — never a real
 * repository path — so this stays hermetic without any special config.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
