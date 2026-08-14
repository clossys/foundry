import { describe, expect, it } from "vitest";

/**
 * `atoms/index.ts`, `blocks/index.ts`, `shell/index.ts`, `charts/index.ts`,
 * and `theme/index.ts` each call `assertPeerVersion` at module top level
 * (see their own doc comments, and `internal/peer-version.ts`'s header).
 * No other test in this package imports these barrels directly — every
 * component test imports its own component file instead (e.g. `Button.
 * test.tsx` imports `./Button.js`, never `./index.js`) — so importing
 * each barrel here is the only place that actually exercises this guard
 * wiring against this repository's own real, installed `react` and
 * `react-aria-components`. A regression that made any of these throw
 * against a genuinely compatible install would fail here first.
 */
// A generous timeout: importing each barrel transforms every component
// file it re-exports (dozens, for `atoms/index.ts`), which is slow under
// vitest's on-the-fly transform the first time it happens, but is not a
// hang — see each `it`'s own real duration once transformed.
const BARREL_IMPORT_TIMEOUT_MS = 30_000;

describe("component subpath barrels load cleanly with real, in-range installed peers", () => {
  it("atoms/index.ts", async () => {
    await expect(import("../atoms/index.js")).resolves.toBeDefined();
  }, BARREL_IMPORT_TIMEOUT_MS);

  it("blocks/index.ts", async () => {
    await expect(import("../blocks/index.js")).resolves.toBeDefined();
  }, BARREL_IMPORT_TIMEOUT_MS);

  it("shell/index.ts", async () => {
    await expect(import("../shell/index.js")).resolves.toBeDefined();
  }, BARREL_IMPORT_TIMEOUT_MS);

  it("charts/index.ts", async () => {
    await expect(import("../charts/index.js")).resolves.toBeDefined();
  }, BARREL_IMPORT_TIMEOUT_MS);

  it("theme/index.ts", async () => {
    await expect(import("../theme/index.js")).resolves.toBeDefined();
  }, BARREL_IMPORT_TIMEOUT_MS);
});
