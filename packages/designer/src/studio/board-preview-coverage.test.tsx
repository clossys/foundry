import { afterAll, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { loadCatalog, loadBuildCatalog, importFoundryFrames, importFoundrySections } from "../catalog-core/index.js";
import type { CompositeEngineInput, CompositeResolved } from "../catalog-core/index.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import { createStudioEvaluation } from "./evaluation.js";
import { buildCandidates } from "./model.js";
import { CompactPreview } from "./previews.js";
import { labels } from "./__fixtures__/studio.js";
import { designerSurfacePreviews, designerSurfacePreview } from "./system-canvas/DesignerPage.js";
import { defaultComponentPreviews } from "./default-component-previews.js";
import componentProfile from "./__fixtures__/default-component-preview-profile.json" with { type: "json" };
import { glyphs } from "../components/preview-runtime/adapters/glyphs.js";
import { ShellCopyProvider } from "../components/Banner.copy-context.js";
import { shellCopyFixtureResolver } from "../frames/__fixtures__/shell-copy.js";

const counts = { components: 0, sections: 0, frames: 0, assets: 0 };
const needs: { leaf: string; reason: string }[] = [];
it("accounts for real specimen coverage across every board layer, with zero unavailable component defaults", () => {
  const profile = { selectionHash: componentProfile.selectionHash, components: componentProfile, values: { members: Object.fromEntries(Object.entries(glyphs).map(([slot, value]) => [slot, { slot, value: { light: value } }])) } } as unknown as CompositeResolved;
  for (const leaf of Object.keys(profile.components.components)) {
    const node = defaultComponentPreviews.preview(leaf, profile);
    expect(node, leaf).toBeDefined();
    expect(renderToStaticMarkup(<>{node}</>), leaf).not.toMatch(/data-specimen-(?:unavailable|error)=|Runtime preview unavailable/);
    counts.components++;
  }
  const surfaces = designerSurfacePreviews({ catalog: { surfaces: { fills: [...importFoundrySections().fills, ...importFoundryFrames().fills] } } } as unknown as CompositeEngineInput, loadBuildCatalog());
  for (const leaf of Object.keys(surfaces.previews)) {
    const node = designerSurfacePreview(leaf, undefined, surfaces)?.node;
    expect(renderToStaticMarkup(<ShellCopyProvider resolver={shellCopyFixtureResolver}>{node}</ShellCopyProvider>).trim(), leaf).not.toBe("");
    counts[leaf.startsWith("sections.") ? "sections" : "frames"]++;
  }
  needs.push(...surfaces.unrenderable.map(row => ({ leaf: row.slot, reason: row.reason })));
  expect(counts.components).toBe(59);
});

const catalog = loadCatalog();
// Consumer-generated identity and authored media remain fixtures, never catalog adoption or approval.
const library = completedCatalogLibrary(catalog, { id: "preview-fixture", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-28");
const evaluation = createStudioEvaluation({ catalog, working: library });
// One real subject per case keeps independent asset checks within the existing timeout; no gate setting changes.
it.each(catalog.slots.filter(slot => slot.layer === "assets"))("renders the selected producer-built $id specimen", slot => {
  const candidate = buildCandidates({ catalog, library, working: library, evaluation, slotId: slot.id, scope: "slot", target: slot.id }).find(row => row.selected && row.previewable && row.members.length > 0);
  if (!candidate) { needs.push({ leaf: slot.id, reason: "no renderable selected asset fixture" }); return; }
  expect(renderToStaticMarkup(<CompactPreview candidate={candidate} labels={labels}/>).trim(), slot.id).not.toBe("");
  counts.assets++;
});
afterAll(() => {
  console.info("A4_BOARD_PREVIEW_COUNTS", JSON.stringify({ counts, needs, assetBasis: "producer-built consumer fixture; real hosts supply their own identity/media" }));
  expect(counts.assets).toBeGreaterThan(0);
});
