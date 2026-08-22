import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/bouncer.
 *
 * Plain Node environment — nothing here needs jsdom. The one React surface
 * this package has (`providers/clerk/web/client.tsx`) is exercised by calling
 * its components as ordinary functions and inspecting the returned elements,
 * not by mounting them, which is both faster and a truer test of the only
 * thing this package decides in that file.
 *
 * `cli.test.ts` does real filesystem I/O, but only against a per-test
 * `mkdtemp` temp directory (see its own setup) — never a real repository path
 * — so this stays hermetic without any special config. Every checker in
 * `contract.ts` is pure and touches no disk at all.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    testTimeout: 5_000,
    globals: false,
  },
});
