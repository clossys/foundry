import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @clossys/integrator.
 * Plain Node environment. No test ever calls a real `fetch` or touches a real
 * filesystem: the registry transport and the manifest/lockfile reader are both
 * injected ports, so every test runs against an in-memory double.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
