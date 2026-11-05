/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { importFoundryFrames, importFoundrySections, loadBuildCatalog } from "../../catalog-core/index.js";
import type { CompositeEngineInput, CompositeResolved } from "../../catalog-core/types.js";
import { designerSurfacePreviews, designerSurfacePreview } from "./DesignerPage.js";
import { specimenDataset } from "../specimen-dataset.js";
import { ShellCopyProvider } from "../../components/Banner.copy-context.js";
import { shellCopyFixtureResolver } from "../../frames/__fixtures__/shell-copy.js";

const contracts = loadBuildCatalog();
const fills = [...importFoundrySections().fills, ...importFoundryFrames().fills];
const input = { catalog: { surfaces: { fills } }, library: { surfaces: { fills: [] } } } as unknown as CompositeEngineInput;
const emptyProfile = { surfaces: { fills: {} } } as unknown as CompositeResolved;

describe("Designer page surface defaults", () => {
  it("renders package defaults without adopting or approving them, and accounts for every surface leaf", () => {
    const before = JSON.stringify(input);
    const previews = designerSurfacePreviews(input, contracts);
    const available = Object.keys(previews.previews);
    const missing = previews.unrenderable.map(row => row.slot);
    const leaves = contracts.slots.filter(row => row.layer === "sections" || row.layer === "frames").map(row => row.id);
    expect([...available, ...missing].sort()).toEqual([...leaves].sort());
    expect(available.filter(id => id.startsWith("sections.")).length).toBeGreaterThanOrEqual(45);
    expect(available.filter(id => id.startsWith("frames.")).length).toBeGreaterThanOrEqual(9);
    expect(renderToStaticMarkup(<>{designerSurfacePreview("sections.faq", emptyProfile, previews)?.node}</>)).toContain(specimenDataset.sections.faq.items[0]!.question);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("SSR renders each available planned and selected composition and reports real per-layer preview counts", () => {
    const previews = designerSurfacePreviews(input, contracts);
    const counts = { planned: { sections: 0, frames: 0 }, selected: { sections: 0, frames: 0 } };
    const failures: { leaf: string; mode: string; reason: string }[] = [];
    for (const leaf of Object.keys(previews.previews)) {
      const document = fills.find(row => row.$extensions["com.clossys.fill"].slot === leaf)!;
      const profile = { surfaces: { fills: { [leaf]: { document } } } } as unknown as CompositeResolved;
      for (const mode of ["planned", "selected"] as const) {
        try {
          const node = designerSurfacePreview(leaf, mode === "planned" ? emptyProfile : profile, previews)?.node;
          if (node == null) throw new Error("resolved preview returned no specimen");
          const html = renderToStaticMarkup(<ShellCopyProvider resolver={shellCopyFixtureResolver}>{node}</ShellCopyProvider>);
          if (!html.trim()) throw new Error("rendered specimen was empty");
          if (/Runtime preview unavailable|Not chosen/.test(html)) throw new Error("rendered specimen contains an unavailable placeholder");
          counts[mode][leaf.startsWith("sections.") ? "sections" : "frames"] += 1;
        } catch (error) {
          failures.push({ leaf, mode, reason: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    console.info("A4_SURFACE_PREVIEW_COUNTS", JSON.stringify({ counts, needs: previews.unrenderable, failures }));
    expect(failures).toEqual([]);
    expect(counts.planned).toEqual(counts.selected);
    expect(counts.planned.sections + counts.planned.frames).toBe(Object.keys(previews.previews).length);
  });

  it("never borrows a planned default for a selected implementation with a different pointer", () => {
    const previews = designerSurfacePreviews(input, contracts);
    const original = fills.find(row => row.$extensions["com.clossys.fill"].slot === "sections.faq")!;
    const custom = structuredClone(original) as typeof original;
    const meta = custom.$extensions["com.clossys.fill"];
    meta.id = "consumer/sections.faq";
    meta.source = "consumer";
    const entry = Object.values(custom.sections!)[0]! as unknown as { impl: { module: string; export: string } };
    entry.impl = { module: "@consumer/ui", export: "Faq" };
    const profile = { surfaces: { fills: { "sections.faq": { document: custom } } } } as unknown as CompositeResolved;
    expect(designerSurfacePreview("sections.faq", profile, previews)).toBeUndefined();
  });

  it("checks the selected mapping even when its package pointer and fill id still match the default", () => {
    const previews = designerSurfacePreviews(input, contracts);
    const custom = structuredClone(fills.find(row => row.$extensions["com.clossys.fill"].slot === "sections.faq")!);
    (Object.values(custom.sections!)[0]! as { slotMap: Record<string, unknown> }).slotMap = {};
    const profile = { surfaces: { fills: { "sections.faq": { document: custom } } } } as unknown as CompositeResolved;
    expect(designerSurfacePreview("sections.faq", profile, previews)).toBeUndefined();
  });

  it.each(["export", "slot-target", "member-target"] as const)("refuses a selected surface that changes its canonical %s while retaining the same leaf", change => {
    const previews = designerSurfacePreviews(input, contracts);
    const custom = structuredClone(fills.find(row => row.$extensions["com.clossys.fill"].slot === "sections.faq")!);
    const entry = Object.values(custom.sections!)[0]!;
    if (change === "export") entry.impl.export = "Hero";
    if (change === "slot-target") (entry.slotMap as Record<string, string>).items = "./blocks#Faq.heading";
    if (change === "member-target") (entry.propMap as Record<string, string>)["layout.list"] = "./blocks#Faq.layout=two-column";
    const profile = { surfaces: { fills: { "sections.faq": { document: custom } } } } as unknown as CompositeResolved;
    expect(designerSurfacePreview("sections.faq", profile, previews)).toBeUndefined();
  });
});
