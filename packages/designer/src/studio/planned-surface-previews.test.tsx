/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { importFoundryFrames, importFoundrySections, loadBuildCatalog, planSurfaceDefaults } from "../catalog-core/index.js";
import type { SurfaceDefaultCandidateDocument, SurfaceDefaultsInput } from "../catalog-core/index.js";
import * as studioEntry from "./index.js";
import { planSurfacePreviews } from "./planned-surface-previews.js";

function realPlan() {
  const slots = loadBuildCatalog().slots.filter(slot => slot.layer === "sections" || slot.layer === "frames") as SurfaceDefaultsInput["catalog"]["slots"];
  const fills: SurfaceDefaultCandidateDocument[] = [...importFoundrySections().fills, ...importFoundryFrames().fills];
  return { fills, plan: planSurfaceDefaults({ catalog: { slots, fills }, slots: slots.map(slot => slot.id), preference: ["foundry"] }) };
}

describe("planSurfacePreviews", () => {
  it("exports the producer from the studio entry as the same function", () => {
    expect(studioEntry.planSurfacePreviews).toBe(planSurfacePreviews);
  });

  it("accounts for every planned Sections/Frames leaf of the real catalog: a preview or a named reason", () => {
    const { plan, fills } = realPlan();
    const planned = plan.rows.filter(row => row.status !== "not-chosen");
    expect(planned.filter(row => row.slot.startsWith("sections."))).toHaveLength(45);
    expect(planned.filter(row => row.slot.startsWith("frames."))).toHaveLength(8);
    const result = planSurfacePreviews({ plan, fills });
    const previewed = Object.keys(result.previews), gaps = result.unrenderable.map(gap => gap.slot);
    expect([...previewed, ...gaps].sort()).toEqual(planned.map(row => row.slot).sort());
    expect(previewed.filter(slot => slot.startsWith("sections."))).toHaveLength(34);
    for (const slot of ["sections.activity-feed", "sections.audit-log", "sections.timeline", "sections.usage"]) expect(previewed, slot).toContain(slot);
    expect(previewed.filter(slot => slot.startsWith("frames.")).sort()).toEqual(["frames.app-header", "frames.inspector", "frames.site-footer", "frames.site-header"]);
    expect(result.unrenderable.every(gap => gap.reason.length > 0)).toBe(true);
    // A Publisher frame is reported, never imitated by a designer export.
    expect(result.unrenderable.find(gap => gap.slot === "frames.site-shell")?.reason).toBe("@clossys/publisher/web#SiteFrame is not a designer export; the designer does not render it");
    expect(result.unrenderable.find(gap => gap.slot === "sections.form")?.reason).toBe("no preview sample content for @clossys/designer/blocks#Form");
    for (const leaf of ["consent", "error-state", "stats", "data-grid", "cards", "call-to-action", "notices", "gallery", "data-table"]) expect(previewed, leaf).toContain(`sections.${leaf}`);
    expect(result.unrenderable.find(gap => gap.slot === "frames.sheet")?.reason).toBe("no preview sample content for @clossys/designer/blocks#Drawer");
  });

  it("previews only planned rows and carries the plan's own fill and source, never a new provenance", () => {
    const { plan, fills } = realPlan();
    const result = planSurfacePreviews({ plan, fills });
    for (const row of plan.rows) {
      const preview = result.previews[row.slot];
      if (row.status === "not-chosen") { expect(preview).toBeUndefined(); continue; }
      if (!preview) continue;
      expect(preview).toMatchObject({ slot: row.slot, fill: row.fill, source: row.source });
    }
    expect(result.previews["sections.faq"]?.pointer).toBe("@clossys/designer/blocks#Faq");
    // Not-chosen rows produce nothing, even when a sample exists for the export.
    const demoted = { rows: plan.rows.map(row => row.slot === "sections.faq" ? { ...row, status: "not-chosen" as const } : row) };
    expect(planSurfacePreviews({ plan: demoted, fills }).previews["sections.faq"]).toBeUndefined();
  });

  it("renders each preview with the real block export and its sample content", () => {
    const { plan, fills } = realPlan();
    const result = planSurfacePreviews({ plan, fills });
    const html = Object.fromEntries(Object.values(result.previews).map(preview => [preview.slot, renderToStaticMarkup(<>{preview.render()}</>)]));
    for (const [slot, markup] of Object.entries(html)) expect(markup.length, slot).toBeGreaterThan(20);
    expect(html["sections.faq"]).toContain("How does billing work?");
    expect(html["sections.access-matrix"]).toContain("View projects");
    expect(html["sections.pagination"]).toContain("nav");
    expect(html["frames.site-header"]).toContain("Northwind");
    expect(html["sections.filter-builder"]).toContain("Filter records");
    expect(html["sections.settings"]).toContain("Workspace settings");
    expect(html["sections.wizard"]).toContain("Setup steps");
    expect(html["frames.inspector"]).toContain("<aside");
    expect(result.previews["frames.inspector"]?.pointer).toBe("@clossys/designer/frames#InspectorFrame");
    expect(result.previews["frames.site-header"]?.pointer).toBe("@clossys/designer/shell/server#SiteHeader");
  });

  it("reports a planned fill missing from the candidate documents instead of rendering it", () => {
    const { plan } = realPlan();
    const result = planSurfacePreviews({ plan, fills: [] });
    expect(Object.keys(result.previews)).toHaveLength(0);
    expect(result.unrenderable.find(gap => gap.slot === "sections.faq")?.reason).toBe("planned fill foundry/sections.faq is not among the candidate documents");
  });
});
