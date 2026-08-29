import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @clossys/butler.
 *
 * Default environment is "node" — the core, `./inbound`, and the CLI have no
 * DOM dependency at all. Only `./web`'s hook test needs a real `document`,
 * and it opts in per-file with a `// @vitest-environment jsdom` pragma, the
 * same pattern `packages/consent` already uses rather than paying jsdom's
 * cost for every test in this package.
 *
 * `cli.test.ts` does real filesystem I/O, but only against a per-test
 * `mkdtemp` temp directory (see that file's own setup) — never a real
 * repository path — so this stays hermetic with no special config.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
