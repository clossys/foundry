import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Builds dist/ once, before any test file runs; test files never rebuild it (#1385).
    globalSetup: ["../../scripts/lib/vitest-build-package.mjs"],
  },
});
