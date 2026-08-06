import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/release.
 *
 * Unlike every layer below it, this package's whole reason to exist is real
 * subprocess I/O: `npm pack`, `npm install` into a genuinely isolated
 * temporary directory, and a `node --input-type=module` import check, all
 * run for real against this repository's own packages. That is inherently
 * slower than any test elsewhere in this foundation, so both the per-test
 * and per-hook timeouts are generous rather than the 5s default the other
 * packages use — a slow pass is expected here, not a problem to chase.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    globals: false,
  },
});
