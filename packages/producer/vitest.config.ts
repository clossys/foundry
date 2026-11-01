import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Match the Studio tsconfig alias when record fixtures render existing Designer components.
  resolve: { alias: { "@": fileURLToPath(new URL("../designer/ui/src", import.meta.url)) } },
  test: {
    environment: "node",
    globalSetup: ["../../scripts/lib/vitest-build-package.mjs"],
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
