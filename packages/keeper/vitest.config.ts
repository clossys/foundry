import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/keeper.
 *
 * Default environment is "node" — the schema, the decision core and the CLI
 * have no DOM dependency at all. Only `./web`'s hook test needs a real
 * `document`, and it opts in per-file with a `// @vitest-environment jsdom`
 * pragma, the same pattern `packages/butler` uses rather than paying jsdom's
 * cost for every test in this package.
 *
 * `cli.test.ts` does real filesystem I/O, but only against a per-test
 * `mkdtemp` temp directory (see that file's own setup) — never a real
 * repository path, and never a real holding record. Nothing this package
 * tests writes a person-attributable record anywhere.
 *
 * `justification.check.ts` is deliberately NOT matched by `include`: it is a
 * compile-time-only file, checked by `tsc`, and running it as a test would be
 * the exact mistake it exists to avoid.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
