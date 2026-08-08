import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/voice.
 * Plain Node environment. This package's own runtime code (`src/*.ts`,
 * excluding `*.test.ts`) does zero I/O — `checkCopy` and every
 * schema/validation function take already-in-memory strings and objects and
 * return data; nothing there reads a file or opens a socket.
 * `src/field-coverage.test.ts` is the one exception, reading this package's
 * own `templates/voice-record.template.jsonc` off disk to check it against
 * `src/fields.ts` — the same call `@vespeneventures/tokens`' own
 * `brand-coverage.test.ts` makes for `brand-template.css`. Every OTHER test
 * file stays fully hermetic: an inline literal fixture, never a real
 * filesystem path outside this package or a network call.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
