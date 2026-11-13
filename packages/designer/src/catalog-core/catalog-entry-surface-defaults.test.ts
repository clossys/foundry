/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import * as catalogEntry from "./index.js";
import type { SurfaceDefaultBasis, SurfaceDefaultCandidateDocument, SurfaceDefaultDecision, SurfaceDefaultRow, SurfaceDefaultsInput, SurfaceDefaultsPlan } from "./index.js";
import { planSurfaceDefaults } from "./surface-defaults.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { FRAME_LEAVES, SECTION_LEAVES, SURFACE_DEFAULTS } from "./__fixtures__/surface-engine/catalog-surface-counts.js";

describe("catalog entry surface-defaults surface", () => {
  it("exports planSurfaceDefaults and the surface candidate inventories from the catalog entry as the same functions", () => {
    expect(catalogEntry.planSurfaceDefaults).toBe(planSurfaceDefaults);
    expect(catalogEntry.importFoundrySections).toBe(importFoundrySections);
    expect(catalogEntry.importFoundryFrames).toBe(importFoundryFrames);
  });

  it("plans the real catalog through the entry alone", () => {
    const build = catalogEntry.loadBuildCatalog();
    const slots = build.slots.filter(slot => slot.layer === "sections" || slot.layer === "frames") as SurfaceDefaultsInput["catalog"]["slots"];
    const fills: SurfaceDefaultCandidateDocument[] = [...catalogEntry.importFoundrySections().fills, ...catalogEntry.importFoundryFrames().fills];
    const plan: SurfaceDefaultsPlan = catalogEntry.planSurfaceDefaults({ catalog: { slots, fills }, slots: slots.map(slot => slot.id), preference: ["foundry"] });
    // One row per Sections and Frames IA leaf; one decision per leaf the importer's coverage defaults.
    expect(plan.rows.map(row => row.slot).sort()).toEqual([...SECTION_LEAVES, ...FRAME_LEAVES].sort());
    expect(plan.decisions.map(row => row.slot).sort()).toEqual([...SURFACE_DEFAULTS].sort());
    const basis: SurfaceDefaultBasis = "preference";
    const row: SurfaceDefaultRow = plan.rows.find(candidate => candidate.slot === "frames.sheet")!;
    const decision: SurfaceDefaultDecision = plan.decisions.find(candidate => candidate.slot === "frames.sheet")!;
    expect(row.basis).toBe(basis);
    expect(decision).toMatchObject({ kind: "adopt", fill: row.fill });
  });
});
