import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/ledger.
 * Plain Node environment. This package's own source does zero I/O except
 * `cli.ts`'s file reads; every other module is pure, and the CLI's own
 * tests use `node:fs`'s `mkdtemp` for hermetic temp directories — no jsdom
 * needed anywhere.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
