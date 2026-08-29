import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @clossys/builder.
 * Plain Node environment. The provisioning half of this package runs every
 * test against the in-memory FileSystemPort rather than a real home
 * directory; the CI-mechanics half injects every observation rather than
 * reading a live machine or calling a network — the whole reason both are
 * ports, not ambient state, is that the alternative is a test suite that can
 * damage the machine running it or depend on what happens to be true of it.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
