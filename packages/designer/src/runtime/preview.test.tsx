// @vitest-environment jsdom
/** Studio previews through the package runtime renderers: every registered leaf, from its Foundry fill entry. */
import "@testing-library/jest-dom/vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { specimenDataset } from "../studio/specimen-dataset.js";
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
  it("previews Frames chrome from the shared dataset's frames records", () => {
    const F = specimenDataset.frames;
    const draw = (leaf: string) => {
      const preview = surfaceRuntimePreview(entryOf(leaf));
      if (!("render" in preview)) throw new Error(`${leaf} preview refused: ${preview.reason}`);
      return render(<>{preview.render()}</>).container;
    };
    draw("frames.app-shell");
    expect(screen.getByText(F.app.skipLabel)).toBeInTheDocument();
    cleanup();
    expect(draw("frames.command")).toHaveTextContent(F.command.trigger);
    cleanup();
    expect(draw("frames.sheet")).toHaveTextContent(F.sheet.trigger);
    cleanup();
    expect(draw("frames.site-footer")).toHaveTextContent(F.siteFooter.columns[0]!.heading);
  });
  it("draws a band around the first registered Section its contract admits", () => {
    const band = surfaceRuntimePreview(entryOf("sections.band")), child = surfaceRuntimePreview(entryOf("sections.access-matrix"));
    if (!("render" in band) || !("render" in child)) throw new Error("band or access-matrix preview refused");
    const childText = render(<>{child.render()}</>).container.textContent!;
    cleanup();
    expect(render(<>{band.render()}</>).container.textContent).toBe(childText);
  });
  it("gives a reason for an unregistered leaf or a sample slot the fill does not map", () => {
    expect(surfaceRuntimePreview({ slot: "sections.not-a-leaf" })).toEqual({ reason: "no package runtime renderer for sections.not-a-leaf" });
    const faq = entryOf("sections.faq");
    expect(surfaceRuntimePreview({ ...faq, slotMap: {} })).toMatchObject({ reason: expect.stringMatching(/^sections\.faq sample content \w+ is not mapped by this fill$/) });
  });
});
