import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @clossys/giver.
 *
 * Plain Node environment — nothing here needs jsdom, and nothing in this
 * package touches React. Every checker and every decision function in
 * `contract.ts` and `record.ts` is pure, takes its instant as a parameter,
 * and touches no disk at all.
 *
 * `cli.test.ts` does real filesystem I/O, but only against a per-test
 * `mkdtemp` temp directory (see its own setup) — never a real repository
 * path — so this stays hermetic without any special config.
 *
 * `collaborators.check.ts` is deliberately NOT matched by `include`: it is
 * a compile-time-only file, checked by `tsc`, and running it as a test
 * would be the exact mistake it exists to avoid.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
