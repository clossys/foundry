import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/verify-standards.
 *
 * Plain Node environment, and deliberately nothing else. Every check in this
 * package is a pure function of already-collected observations, and the CLI
 * takes its filesystem, clock, and output streams as an injected port
 * object, so no test here reads a real file, spawns a process, or opens a
 * socket. A gate whose own test suite needs the network cannot be trusted to
 * report honestly about a network it could not reach.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
