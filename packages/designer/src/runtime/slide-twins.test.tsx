// @vitest-environment jsdom
/**
 * The slide twins render on the slide medium (foundry-build-0042, S9). Each retired slide section names its live
 * twin and the slide config it became; the twin's contract declares the slide medium and admits that config's
 * members, and the twin's registered renderer draws its sample with those members selected.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import slides from "../catalog/ia/slides.json" with { type: "json" };
import sectionSlots from "../catalog/slots/sections.json" with { type: "json" };
import { ShellCopyProvider } from "../components/Banner.copy-context.js";
import { shellCopyFixtureResolver } from "../frames/__fixtures__/shell-copy.js";
import { surfaceRuntimeRenderers } from "./index.js";
import { copyPortsFor } from "./sections/__fixtures__/copy-ports.js";
import { surfaceRuntimePreview, type SurfacePreviewEntry } from "./preview.js";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("min-width") || media === "all", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type Retired = { id: string; replacedBy: string; config: string };
type Row = { id: string; contract: { media?: readonly string[]; members?: { names?: readonly string[] } } };
const retired = (slides as { retired: Retired[] }).retired;
const rows = new Map((sectionSlots as unknown as Row[]).map(row => [row.id, row]));
const fills = resolve(dirname(fileURLToPath(import.meta.url)), "../catalog/fills/foundry");
const entryOf = (leaf: string): SurfacePreviewEntry => {
  const doc = JSON.parse(readFileSync(resolve(fills, `${leaf}.json`), "utf8")) as { sections?: Record<string, SurfacePreviewEntry> };
  return Object.values(doc.sections ?? {})[0]!;
};
const SLIDE = "medium.slide";

describe("slide twins on the slide medium", () => {
  it("names a slide config for every retired slide section", () => {
    expect(retired.length).toBeGreaterThan(0);
    for (const entry of retired) expect(entry.config.split(" "), entry.id).toContain(SLIDE);
  });

  it.each(retired.map(entry => [entry.id, entry] as const))("%s: its twin declares the slide medium, admits the config and renders on it", (_id, entry) => {
    const twin = rows.get(entry.replacedBy);
    expect(twin, `${entry.id} twin ${entry.replacedBy}`).toBeDefined();
    expect(twin!.contract.media).toContain("slide");
    const members = entry.config.split(" ").filter(member => member !== SLIDE);
    for (const member of members) expect(twin!.contract.members?.names, `${entry.replacedBy} member ${member}`).toContain(member);
    expect(Object.hasOwn(surfaceRuntimeRenderers, entry.replacedBy)).toBe(true);
    // A single-layout slide (the quote slide) holds one item: its sample keeps the first of each list.
    if (members.includes("layout.single")) {
      const row = surfaceRuntimeRenderers[entry.replacedBy]!, sample = row.sample.bind(row);
      vi.spyOn(row, "sample").mockImplementation(dataset => Object.fromEntries(Object.entries(sample(dataset)).map(([key, value]) => [key, Array.isArray(value) ? value.slice(0, 1) : value])));
    }
    const preview = surfaceRuntimePreview(entryOf(entry.replacedBy), { members, sectionHost: copyPortsFor(entry.replacedBy) });
    if (!("render" in preview)) throw new Error(`${entry.replacedBy} on the slide medium refused: ${preview.reason}`);
    const { container } = render(<ShellCopyProvider resolver={shellCopyFixtureResolver}>{preview.render()}</ShellCopyProvider>);
    expect(container.innerHTML).toContain(`data-provenance-leaf="${entry.replacedBy}"`);
    expect(container.textContent!.trim().length).toBeGreaterThan(0);
  });
});
