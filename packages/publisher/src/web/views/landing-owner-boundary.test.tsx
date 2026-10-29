import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Every former executable Designer landing seam belongs to Publisher. Data
 * contracts may still cross the package boundary; renderer values may not. */
describe("Publisher landing renderer ownership", () => {
  it.each([
    "preview/render-preview-gallery.ts",
    "preview/render-content-catalog.ts",
    "preview/catalog/reader-renderer.ts",
    "preview/catalog/contract-reference.ts",
    "web/views/index.ts",
    "web/views/server.ts",
    "web/index.ts",
    "web/server.ts",
  ])("keeps %s independent of deprecated Designer landing values", file => {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    expect(source).not.toMatch(/(?:import|export)\s*\{[^}]*\b(?:ServerLandingView|LandingView)\b[^}]*\}\s*from\s*["'][^"']+["']/);
  });
  it("retires the executable alias from ordinary, client and server entries", async () => {
    const entries = await Promise.all([import("@clossys/publisher/web"), import("@clossys/publisher/web/client"), import("./server.js")]);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty("LandingView");
      expect(entry).toHaveProperty("SectionedView");
    }
  });
});
