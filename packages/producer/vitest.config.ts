import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["../../scripts/lib/vitest-build-package.mjs"],
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
