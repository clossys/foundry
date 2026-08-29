import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @clossys/inspector.
 *
 * Plain Node environment, and deliberately nothing else. Every check in this
 * package's judge half is a pure function of already-collected observations,
 * and the CLI takes its filesystem, clock, and output streams as an injected
 * port object, so no test here reads a real file, spawns a process, or opens
 * a socket. A gate whose own test suite needs the network cannot be trusted
 * to report honestly about a network it could not reach.
 *
 * The `./secret-scan` subpath is the one place in this package that does
 * real I/O — downloading a verified binary, and now running it — and its
 * tests hold to the same rule the same way: `fetch` and process execution
 * are both injected, never called for real. See `src/secret-scan/gitleaks.test.ts`
 * and `src/secret-scan/attempt.test.ts`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
