import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @clossys/designer-ui (./ui) has no test script; its React tests run here, from
 * `npm run check:studio`, with the package's jsdom setup. `@/` is the package's own
 * tsconfig path (shadcn's alias: command.tsx imports "@/components/ui/dialog").
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./ui/src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: ["ui/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 10_000,
    globals: false,
  },
});
