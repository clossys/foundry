// @vitest-environment jsdom
/** Studio previews through the package runtime renderers: every registered leaf, from its Foundry fill entry. */
import "@testing-library/jest-dom/vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { surfaceRuntimeRenderers } from "./index.js";
import { surfaceRuntimePreview, type SurfacePreviewEntry } from "./preview.js";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("min-width"), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const fills = resolve(dirname(fileURLToPath(import.meta.url)), "../catalog/fills/foundry");
const entryOf = (leaf: string): SurfacePreviewEntry => {
  const doc = JSON.parse(readFileSync(resolve(fills, `${leaf}.json`), "utf8")) as { sections?: Record<string, SurfacePreviewEntry>; frames?: Record<string, SurfacePreviewEntry> };
  return Object.values({ ...doc.sections, ...doc.frames })[0]!;
};

describe("surfaceRuntimePreview", () => {
  it("previews every registered leaf from its Foundry fill through the registered renderer", () => {
    const leaves = Object.keys(surfaceRuntimeRenderers).sort();
    expect(leaves).toEqual(readdirSync(fills).map(name => name.replace(/\.json$/, "")).filter(leaf => Object.hasOwn(surfaceRuntimeRenderers, leaf)).sort());
    const reasons: Record<string, string> = {};
    for (const leaf of leaves) {
      const preview = surfaceRuntimePreview(entryOf(leaf));
      if ("reason" in preview) { reasons[leaf] = preview.reason; continue; }
      const view = render(<>{preview.render()}</>);
      expect(view.container.innerHTML.length, leaf).toBeGreaterThan(0);
      cleanup();
    }
    expect(reasons).toEqual({});
  });
  it("gives a reason for an unregistered leaf or a sample slot the fill does not map", () => {
    expect(surfaceRuntimePreview({ slot: "sections.not-a-leaf" })).toEqual({ reason: "no package runtime renderer for sections.not-a-leaf" });
    const faq = entryOf("sections.faq");
    expect(surfaceRuntimePreview({ ...faq, slotMap: {} })).toMatchObject({ reason: expect.stringMatching(/^sections\.faq sample content \w+ is not mapped by this fill$/) });
  });
});
