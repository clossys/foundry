import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Match the Studio tsconfig alias when record fixtures render existing Designer components.
  resolve: { alias: { "@": fileURLToPath(new URL("../designer/ui/src", import.meta.url)) } },
  test: {
    environment: "node",
    globalSetup: ["../../scripts/lib/vitest-build-package.mjs"],
    // Temp roots resolve symlinks so the symlinked-ancestor refusal stays strict (macOS /var).
    // The reaper fails a test file that leaves a Studio child fixture running, and kills it.
    setupFiles: ["../../scripts/lib/vitest-realpath-tmpdir.mjs", "./src/server/__fixtures__/studio-child-reaper.ts"],
    include: ["src/**/*.test.ts"],
    testTimeout: 5_000,
    globals: false,
  },
});
