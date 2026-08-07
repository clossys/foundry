import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/voice.
 * Plain Node environment. This package does zero I/O anywhere in `src/` —
 * `checkCopy` and every schema/validation function take already-in-memory
 * strings and objects and return data; nothing here reads a file or opens a
 * socket. Tests are hermetic for the same reason: every fixture is an inline
 * literal, never a real filesystem path or network call.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
