/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import cardSource from "./__fixtures__/shadcn-aria/card.json" with { type: "json" };
import railSource from "./vendor/shadcn-aria-rail.data.json" with { type: "json" };
import { loadCatalog } from "../catalog-core/index.js";
import { loadSectionRegistry } from "../catalog-core/sections-contract.js";
import { planSurfaceDefaults } from "../catalog-core/surface-defaults.js";
import { materializeSurfaceSourceFill } from "../catalog-core/surface-materialize.js";
import { surfaceEntryOf, verifySurfaceFiles } from "../catalog-core/surface-library.js";
import { syntheticSurface } from "../catalog-core/__fixtures__/surface-engine/synthetic.js";
import { importFoundrySections } from "./foundry-sections.js";
import { importShadcnSections, SHADCN_SECTIONS_PIN, shadcnSectionMaterializations } from "./shadcn-sections.js";
import type { CompositeCatalogData } from "../catalog-core/types.js";

function fixture() {
  const source = importShadcnSections();
  const template = syntheticSurface();
  const catalog: CompositeCatalogData = {
    values: loadCatalog(), components: template.input.catalog.components,
    surfaces: { slots: loadSectionRegistry().slots.filter(slot => source.fills.some(fill => fill.$extensions["com.clossys.fill"].slot === slot.id)), fills: source.fills, transforms: source.transforms, rules: [], materializations: [] },
  };
  catalog.surfaces!.materializations = shadcnSectionMaterializations(catalog, template.input.library.source.id);
  return { source, catalog, library: template.input.library };
}
const authenticatedSource = (path: string) => path === "LICENSE.md"
  ? railSource.files.find(row => row.item === "license")!.content
  : path.endsWith("/card.tsx") ? cardSource.files[0]!.content
  : railSource.files.find(row => row.item === "empty")!.content;

describe("pinned shadcn section candidates", () => {
  it("registers three distinct existing section leaves with honest Card/Empty provenance", () => {
    const { source } = fixture();
    expect(source.fills.map(fill => fill.$extensions["com.clossys.fill"].slot).sort()).toEqual(["sections.content", "sections.empty-state", "sections.section-header"]);
    for (const doc of source.fills) {
      const row = Object.values(doc.sections!)[0]!;
      expect(row.impl.kind).toBe("source");
      expect(row.pin).toMatchObject({ kind: "git", commit: SHADCN_SECTIONS_PIN.commit });
      expect(row.pin.files).toHaveLength(2);
      expect(row.composes).toEqual(["components.semantic-content"]);
      expect(doc.$extensions["com.clossys.fill"].status).toBe("draft");
      expect(doc.$extensions["com.clossys.fill"].sourceAddress).toContain(row.slot === "sections.empty-state" ? "empty.tsx" : "card.tsx");
    }
  });

  it("uses normal preference planning, while explicit Foundry choices still win", () => {
    const { source, catalog } = fixture();
    const slots = catalog.surfaces!.slots;
    const input = { catalog: { slots, fills: [...importFoundrySections().fills, ...source.fills] }, slots: slots.map(slot => slot.id), preference: ["shadcn@aria", "foundry", "rac-starter"] };
    const plan = planSurfaceDefaults(input);
    expect(plan.rows).toHaveLength(3);
    expect(plan.rows.every(row => row.source === "shadcn@aria" && row.reasons.length === 0)).toBe(true);
    expect(planSurfaceDefaults({ ...input, choices: { "sections.section-header": "foundry" } }).rows.find(row => row.slot === "sections.section-header")?.source).toBe("foundry");
  });

  it("materializes each real source candidate through authenticated upstream bytes and exact native receipts", async () => {
    const { source, catalog, library } = fixture();
    for (const [index, doc] of source.fills.entries()) {
      const slot = doc.$extensions["com.clossys.fill"].slot as `sections.${string}`;
      const bundle = await materializeSurfaceSourceFill({ catalog, library, slot, source: "shadcn@aria", rule: null, transform: source.transforms[index]!.identity.id, fetch: async request => authenticatedSource(request.path), surfaceOptions: { packages: [], measurements: [] } });
      const entry = surfaceEntryOf(bundle.document);
      expect(entry.impl.kind).toBe("source");
      expect(bundle.base.source).toBe("shadcn@aria");
      expect(bundle.files.some(file => file.path.startsWith("surfaces/receipts/"))).toBe(true);
      expect(bundle.files.find(file => file.path.endsWith(".tsx"))!.content).toContain('from "@clossys/designer/components"');
      verifySurfaceFiles(entry as Parameters<typeof verifySurfaceFiles>[0], bundle.files);
    }
  });

  it("refuses tampered upstream and missing receipts instead of treating a selectable candidate as adoption proof", async () => {
    const { source, catalog, library } = fixture();
    const slot = "sections.empty-state";
    const input = { catalog, library, slot, source: "shadcn@aria", rule: null, transform: source.transforms[2]!.identity.id, fetch: async (request: { path: string }) => authenticatedSource(request.path), surfaceOptions: { packages: [], measurements: [] } } as const;
    await expect(materializeSurfaceSourceFill({ ...input, fetch: async () => "altered" })).rejects.toThrow("upstream bytes differ");
    catalog.surfaces!.materializations = [];
    await expect(materializeSurfaceSourceFill(input)).rejects.toThrow("materialization receipt missing");
  });

  it("reuses existing upstream caches without duplicating Card source or changing its authenticated pin", () => {
    const imported = importShadcnSections();
    expect(imported.upstream["sections.content"]).toBeUndefined();
    expect(imported.upstream["sections.empty-state"]).toHaveLength(2);
    expect(importShadcnSections().fills).toEqual(imported.fills);
  });
});
