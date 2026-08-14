import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/provisioning.
 * Plain Node environment. Every test runs against the in-memory FileSystemPort
 * rather than a real home directory — the whole reason the port is injected is
 * that the alternative is a test suite that can damage the machine running it.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
