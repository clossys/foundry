import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The Studio app's own tests (sections, frames, lib), run by `npm run check:studio`.
 * The package config covers only src/; these files sit beside the Studio source.
 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../designer/ui/src", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["studio/**/*.test.{ts,tsx}"],
    testTimeout: 10_000,
    globals: false,
  },
});
