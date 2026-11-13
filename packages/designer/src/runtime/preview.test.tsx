// @vitest-environment jsdom
/** Studio previews through the package runtime renderers: every registered leaf, from its Foundry fill entry. */
import "@testing-library/jest-dom/vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { specimenDataset } from "../studio/specimen-dataset.js";
import { ShellCopyProvider } from "../components/Banner.copy-context.js";
import { shellCopyFixtureResolver } from "../frames/__fixtures__/shell-copy.js";
import { surfaceRuntimeRenderers } from "./index.js";
import { copyPortsFor } from "./sections/__fixtures__/copy-ports.js";
import { surfaceRuntimePreview as previewWithoutHost, type SurfacePreviewEntry } from "./preview.js";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("min-width") || media === "all", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const surfaceRuntimePreview = (entry: SurfacePreviewEntry) => previewWithoutHost(entry, { sectionHost: copyPortsFor(String(entry.slot)) });

const fills = resolve(dirname(fileURLToPath(import.meta.url)), "../catalog/fills/foundry");
const entryOf = (leaf: string): SurfacePreviewEntry => {
  const doc = JSON.parse(readFileSync(resolve(fills, `${leaf}.json`), "utf8")) as { sections?: Record<string, SurfacePreviewEntry>; frames?: Record<string, SurfacePreviewEntry> };
  return Object.values({ ...doc.sections, ...doc.frames })[0]!;
};
// Runtime shells consume the host's Writer copy seam; previews do not invent a production language fallback.
const draw = (node: ReactNode) => render(<ShellCopyProvider resolver={shellCopyFixtureResolver}>{node}</ShellCopyProvider>);

describe("surfaceRuntimePreview", () => {
  it("previews every registered leaf from its Foundry fill through the registered renderer", () => {
    const leaves = Object.keys(surfaceRuntimeRenderers).sort();
    expect(leaves).toEqual(readdirSync(fills).map(name => name.replace(/\.json$/, "")).filter(leaf => Object.hasOwn(surfaceRuntimeRenderers, leaf)).sort());
    const reasons: Record<string, string> = {};
    for (const leaf of leaves) {
      const preview = surfaceRuntimePreview(entryOf(leaf));
      if ("reason" in preview) { reasons[leaf] = preview.reason; continue; }
      const view = draw(preview.render());
      expect(view.container.innerHTML.length, leaf).toBeGreaterThan(0);
      cleanup();
    }
    // A document root is the one genuine board gap: drawing html/head/body inside a cell is invalid DOM.
    expect(reasons).toEqual({ "frames.document": "frames.document preview requires an isolated document renderer" });
  });
  it("previews Frames chrome from the shared dataset's frames records", () => {
    const F = specimenDataset.frames;
    const drawFrame = (leaf: string) => {
      const preview = surfaceRuntimePreview(entryOf(leaf));
      if (!("render" in preview)) throw new Error(`${leaf} preview refused: ${preview.reason}`);
      return draw(preview.render()).container;
    };
    drawFrame("frames.app-shell");
    expect(screen.getByText(F.app.skipLabel)).toBeInTheDocument();
    cleanup();
    expect(drawFrame("frames.command")).toHaveTextContent(F.command.trigger);
    cleanup();
    expect(drawFrame("frames.sheet")).toHaveTextContent(F.sheet.trigger);
    cleanup();
    expect(drawFrame("frames.site-footer")).toHaveTextContent(F.siteFooter.columns[0]!.heading);
  });
  it("composes the app-shell preview with its real navigation, leased page header and main fixture", () => {
    const preview = surfaceRuntimePreview(entryOf("frames.app-shell"));
    if (!("render" in preview)) throw new Error(preview.reason);
    const view = draw(preview.render());
    const app = specimenDataset.frames.app;
    // jsdom has no measured sidebar width; inspect the real retained navigation rather than pretending layout was captured.
    expect(view.container.querySelector(`nav[aria-label="${app.navigationLabel}"]`)).toHaveTextContent(app.navigation[0]!.label);
    expect(screen.getByRole("heading", { name: app.page })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: app.heading })).toBeInTheDocument();
    expect(view.container.querySelector("main")).toHaveTextContent(app.body);
  });
  it("draws a band around the first registered Section its contract admits", () => {
    const band = surfaceRuntimePreview(entryOf("sections.band")), child = surfaceRuntimePreview(entryOf("sections.access-matrix"));
    if (!("render" in band) || !("render" in child)) throw new Error("band or access-matrix preview refused");
    const childText = draw(child.render()).container.textContent!;
    cleanup();
    expect(draw(band.render()).container.textContent).toBe(childText);
  });
  it("gives a reason for an unregistered leaf or a sample slot the fill does not map", () => {
    expect(surfaceRuntimePreview({ slot: "sections.not-a-leaf" })).toEqual({ reason: "no package runtime renderer for sections.not-a-leaf" });
    const faq = entryOf("sections.faq");
    expect(surfaceRuntimePreview({ ...faq, slotMap: {} })).toMatchObject({ reason: expect.stringMatching(/^sections\.faq sample content \w+ is not mapped by this fill$/) });
  });
});
