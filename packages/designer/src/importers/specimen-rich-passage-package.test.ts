import { describe, expect, it } from "vitest";
import * as Studio from "../studio/index.js";
import { loadSectionRegistry } from "../catalog-core/index.js";
import { contractFindings } from "../catalog-core/surface-defaults.js";
import { foundrySurfaceCatalog } from "../library-cli/surface-catalog.js";
import { canonicalSurfaceConsumption } from "./foundry-surface-consumption.js";
import { importFoundrySections } from "./foundry-sections.js";

const leaf = "sections.specimen-rich-passage";
function candidate() {
  const document = importFoundrySections({ studioExports: Object.keys(Studio) }).fills.find(doc => doc.$extensions["com.clossys.fill"].slot === leaf);
  if (!document) throw new Error("The registered rich-passage package candidate is unavailable.");
  return { document, fill: Object.values(document.sections)[0]! };
}

describe("registered native rich-passage package candidate", () => {
  it("points to the real public native export with current canonical source facts", () => {
    const { fill } = candidate();
    expect(typeof Studio.SpecimenRichPassage).toBe("function");
    expect(fill.impl).toEqual({ kind: "package", module: "@clossys/designer/studio", export: "SpecimenRichPassage" });
    expect(fill.consumption).toEqual(canonicalSurfaceConsumption(leaf, fill.impl, fill.pin));
    const slot = loadSectionRegistry().slots.find(slot => slot.id === leaf)!;
    expect(contractFindings(slot, fill, fill.pin)).toEqual([]);
    expect(fill.composes).toEqual(["components.disclosure", "components.grid-list", "components.rich-text", "components.semantic-content"]);
    expect(fill.consumption.sourceFiles.map(file => file.path).join("\n")).not.toMatch(/editor-views|specimen-dataset|component-specimen-samples/);
  });

  it("keeps one actual package candidate in the live catalog", () => {
    const candidates = foundrySurfaceCatalog().fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === leaf);
    expect(candidates).toHaveLength(1);
    expect(Object.values(candidates[0]!.sections!)[0]!.impl.kind).toBe("package");
  });

  it("refuses absent native exports and stale package identities", () => {
    expect(() => importFoundrySections({ studioExports: [] })).toThrow("unavailable package export ./studio#SpecimenRichPassage");
    const { fill } = candidate();
    expect(canonicalSurfaceConsumption(leaf, fill.impl, { ...fill.pin, version: "0.0.0" })).toBeUndefined();
  });
});
