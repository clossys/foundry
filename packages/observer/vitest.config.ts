import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Serialize test files. Two suites compile into the same gitignored
    // dist/. Default one-worker-per-file isolation can run those builds
    // concurrently and leave dist/ inconsistent while a reachability
    // suite spawns dist/bin.js. In-process tests import src/ and still pass.
    fileParallelism: false,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
});
