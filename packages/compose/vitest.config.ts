import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/compose. Plain Node
 * environment. Every function this package ships is pure — no filesystem,
 * no network, no environment access anywhere in `src/` — so every test
 * runs against inline literal fixtures only. Nothing here needs `mkdtemp`
 * the way @vespeneventures/copy's `registry.ts` tests do; this package has
 * no I/O surface at all.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
