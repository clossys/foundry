import { defineConfig } from "vitest/config";

/**
 * @clossys/designer-ui (./ui) has no test script; its React tests run here, from
 * `npm run check:studio`, with the package's jsdom setup.
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["ui/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 10_000,
    globals: false,
  },
});
