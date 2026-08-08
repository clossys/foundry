import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config for @vespeneventures/render. Plain Node
 * environment, not jsdom: this package's own tests never mount a component
 * into a DOM (that's @vespeneventures/ui's job, tested in that package).
 * ./web's golden tests assert against `react-dom/server`'s
 * `renderToStaticMarkup` output — a plain string — which runs fine under
 * Node with no DOM at all.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    testTimeout: 5_000,
    globals: false,
  },
});
