/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import * as catalogEntry from "./index.js";
import type { SurfaceDefaultBasis, SurfaceDefaultCandidateDocument, SurfaceDefaultDecision, SurfaceDefaultRow, SurfaceDefaultsInput, SurfaceDefaultsPlan } from "./index.js";
import { planSurfaceDefaults } from "./surface-defaults.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { importFoundryFrames } from "../importers/foundry-frames.js";

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
    expect(plan.rows).toHaveLength(54);
    expect(plan.decisions).toHaveLength(31);
    const basis: SurfaceDefaultBasis = "preference";
    const row: SurfaceDefaultRow = plan.rows.find(candidate => candidate.slot === "frames.sheet")!;
    const decision: SurfaceDefaultDecision = plan.decisions.find(candidate => candidate.slot === "frames.sheet")!;
    expect(row.basis).toBe(basis);
    expect(decision).toMatchObject({ kind: "adopt", fill: row.fill });
  });
});
