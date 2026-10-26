/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { importFoundryFrames, importFoundrySections, loadBuildCatalog, planSurfaceDefaults } from "../catalog-core/index.js";
import type { SurfaceDefaultCandidateDocument, SurfaceDefaultsInput } from "../catalog-core/index.js";
import * as studioEntry from "./index.js";
import { packageSurfacePreview, planSurfacePreviews } from "./planned-surface-previews.js";

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
    expect(planned.filter(row => row.slot.startsWith("sections."))).toHaveLength(26);
    expect(planned.filter(row => row.slot.startsWith("frames."))).toHaveLength(5);
    const result = planSurfacePreviews({ plan, fills });
    const previewed = Object.keys(result.previews), gaps = result.unrenderable.map(gap => gap.slot);
    expect([...previewed, ...gaps].sort()).toEqual(planned.map(row => row.slot).sort());
    // Every planned designer export has sample content; only the Publisher frame waits for its host.
    expect(previewed.filter(slot => slot.startsWith("sections."))).toHaveLength(26);
    expect(previewed.filter(slot => slot.startsWith("frames.")).sort()).toEqual(["frames.app-header", "frames.sheet", "frames.site-footer", "frames.site-header"]);
    expect(result.unrenderable).toEqual([{ slot: "frames.site-shell", reason: "@clossys/publisher/web#SiteFrame is not a designer export; the designer does not render it" }]);
  });

  it("renders a non-designer export only from the host's own sample for that exact pointer", () => {
    const { plan, fills } = realPlan();
    const host = { "@clossys/publisher/web#SiteFrame": () => <p>host-site-frame</p> };
    const result = planSurfacePreviews({ plan, fills, samples: host });
    expect(result.unrenderable).toEqual([]);
    expect(result.previews["frames.site-shell"]).toMatchObject({ pointer: "@clossys/publisher/web#SiteFrame", fill: "foundry/frames.site-shell" });
    expect(renderToStaticMarkup(<>{result.previews["frames.site-shell"]!.render()}</>)).toBe("<p>host-site-frame</p>");
    // A sample for another pointer is never borrowed.
    expect(planSurfacePreviews({ plan, fills, samples: { "@clossys/publisher/web#Other": host["@clossys/publisher/web#SiteFrame"] } }).previews["frames.site-shell"]).toBeUndefined();
  });

  it("previews an adopted package pointer document through the same samples, and names why it cannot", () => {
    const { fills } = realPlan();
    const doc = (slot: string) => fills.find(candidate => candidate.$extensions["com.clossys.fill"].slot === slot)!;
    const table = packageSurfacePreview(doc("sections.data-table"));
    expect(table).toMatchObject({ pointer: "@clossys/designer/blocks#DataTable" });
    expect(renderToStaticMarkup(<>{"render" in table ? table.render() : null}</>)).toContain("Northwind");
    expect(packageSurfacePreview(doc("frames.site-shell"))).toEqual({ reason: "@clossys/publisher/web#SiteFrame is not a designer export; the designer does not render it" });
    expect(packageSurfacePreview({ ...doc("sections.faq"), sections: {} } as SurfaceDefaultCandidateDocument)).toEqual({ reason: "planned fill has no package export pointer" });
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
    // Structured Sections render their real block with sample rows, tiers and items.
    const samples: Record<string, string> = { "sections.comparison": "Version history", "sections.content": "One place for every project", "sections.data-table": "Fabrikam", "sections.form": "Work email", "sections.pricing": "Choose Team", "sections.resource-list": "Help centre", "sections.status-list": "Mobile alerts", "sections.task-list": "Publish the launch page", "frames.sheet": "Open filters" };
    for (const [slot, text] of Object.entries(samples)) expect(html[slot], slot).toContain(text);
    expect(result.previews["sections.comparison"]?.pointer).toBe("@clossys/designer/blocks#Matrix");
    expect(html["sections.comparison"]).toContain("<table");
    expect(result.previews["frames.site-header"]?.pointer).toBe("@clossys/designer/shell/server#SiteHeader");
  });

  it("reports a planned fill missing from the candidate documents instead of rendering it", () => {
    const { plan } = realPlan();
    const result = planSurfacePreviews({ plan, fills: [] });
    expect(Object.keys(result.previews)).toHaveLength(0);
    expect(result.unrenderable.find(gap => gap.slot === "sections.faq")?.reason).toBe("planned fill foundry/sections.faq is not among the candidate documents");
  });
});
