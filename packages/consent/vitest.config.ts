import { defineConfig } from "vitest/config";

// Default environment is "node" — the core package has no DOM dependency at
// all. Only `./web`'s SSR-contract test needs a real `document`, and it
// opts in per-file with a `// @vitest-environment jsdom` pragma, matching
// the pattern `packages/surface` and `packages/ui` already use rather than
// paying jsdom's cost for every test in this package.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    testTimeout: 5_000,
    globals: false,
  },
});
