import { describe, expect, it } from "vitest";
import retired from "../catalog/retired.json" with { type: "json" };
import { loadBuildCatalog } from "./index.js";
import { checkRetiredLeaves } from "./retired-leaves.js";
import type { Retired } from "./types.js";
// The verb is a plain node script; tests are outside tsc, so it is imported untyped.
import { placedLeaves, retireLeaf } from "../../scripts/retire-leaf.mjs";

const placements = [
  { layer: "components", nodes: [{ id: "g", label: "G", children: [{ id: "g-a", label: "A", leaves: ["components.a", "components.b"] }] }] },
  { layer: "sections", nodes: [{ id: "s", label: "S", leaves: ["sections.c"] }] },
] as never;
const codes = (entries: Retired[]) => checkRetiredLeaves(entries, placements).map(finding => finding.message);

describe("retired leaves (owner D2 / LAD-1 / LAD-2 2026-11-11)", () => {
  it("accepts a placed leaf, with or without a same-layer live replacement", () => {
    expect(codes([{ id: "components.a", retiredAt: "2026-11-11" }, { id: "sections.c", retiredAt: "2026-11-11" }])).toEqual([]);
    expect(codes([{ id: "components.a", retiredAt: "2026-11-11", replacedBy: "components.b" }])).toEqual([]);
  });

  it("refuses an unplaced, duplicate, undated or badly replaced retirement", () => {
    expect(codes([{ id: "components.gone", retiredAt: "2026-11-11" }])).toEqual([expect.stringContaining("is not a placed leaf")]);
    expect(codes([{ id: "components.a", retiredAt: "2026-11-11" }, { id: "components.a", retiredAt: "2026-11-11" }])).toEqual([expect.stringContaining("more than once")]);
    expect(codes([{ id: "components.a", retiredAt: "yesterday" }])).toEqual([expect.stringContaining("YYYY-MM-DD")]);
    expect(codes([{ id: "components.a", retiredAt: "2026-11-11", replacedBy: "components.x" }])).toEqual([expect.stringContaining("is not a placed leaf")]);
    expect(codes([{ id: "components.a", retiredAt: "2026-11-11", replacedBy: "sections.c" }])).toEqual([expect.stringContaining("another layer")]);
    expect(codes([{ id: "components.a", retiredAt: "2026-11-11", replacedBy: "components.b" }, { id: "components.b", retiredAt: "2026-11-11" }]))
      .toEqual([expect.stringContaining("is itself retired")]);
  });

  it("the committed registry is valid against the build IA and records the owner's 13 retirements, then foundry-build-0018's 30", () => {
    const build = loadBuildCatalog();
    expect(checkRetiredLeaves(build.retired, build.placements)).toEqual([]);
    expect(build.retired).toEqual(retired);
    expect(Object.fromEntries((retired as Retired[]).map(entry => [entry.id, entry.replacedBy ?? null]))).toEqual({
      "components.chart-heatmap": null, "components.chart-range": null, "components.chart-scatter": null,
      "components.chart-sparkline": null, "components.chart-status-strip": null, "components.chart-waterfall": null,
      "components.native-action": "components.button", "components.number-field": null,
      "sections.boundary-message": null, "sections.legal-prose": null, "sections.logo-mark": null,
      "sections.newsletter": null, "sections.record-detail": null,
      // foundry-build-0018 (designer.md section 7 and audit 0022): merges and withdrawals.
      "components.dropdown-menu": "components.menu",
      "components.canvas-zoom": null, "components.canvas-map": null,
      "sections.logo-hero": "sections.hero", "sections.cards": "sections.link-index",
      "frames.document": null, "frames.sheet": null, "frames.command": null,
      // The 22 Studio specimen leaves, retired in place.
      ...Object.fromEntries(["swatch", "ladder", "player", "grid", "matrix", "viewport", "passage", "copy-in-context"].map(leaf => [`components.specimen-${leaf}`, null])),
      ...Object.fromEntries(["swatch", "color-ramp", "type-ladder", "spacing-ladder", "radius-ladder", "motion-player", "asset-grid", "icon-grid", "variant-matrix", "section-viewports", "frame-viewports", "rich-passage", "copy-in-context", "page-viewports"].map(leaf => [`sections.specimen-${leaf}`, null])),
    });
    expect((retired as Array<Retired & { reason?: string }>).filter(entry => /\.specimen-/.test(entry.id)).every(entry => entry.reason === "studio-killed")).toBe(true);
    expect((retired as Retired[]).filter(entry => /\.specimen-/.test(entry.id))).toHaveLength(22);
  });
});

describe("retire-leaf verb", () => {
  const placed = new Map([["components.a", "components"], ["components.b", "components"], ["sections.c", "sections"]]);
  const at = "2026-11-11";

  it("appends a sorted entry with who and why", () => {
    const one = retireLeaf([], placed, { id: "sections.c", by: "owner:D2", reason: "unused", at });
    expect(retireLeaf(one, placed, { id: "components.a", by: "owner:LAD-2", reason: "merged", replacedBy: "components.b", at }))
      .toEqual([
        { id: "components.a", retiredAt: at, replacedBy: "components.b", decidedBy: "owner:LAD-2", reason: "merged" },
        { id: "sections.c", retiredAt: at, decidedBy: "owner:D2", reason: "unused" },
      ]);
  });

  it("refuses what the load-time check refuses", () => {
    const base = { by: "owner:D2", reason: "unused", at };
    expect(() => retireLeaf([], placed, { ...base, id: "components.gone" })).toThrow(/not a placed leaf/);
    expect(() => retireLeaf([{ id: "components.a", retiredAt: at }], placed, { ...base, id: "components.a" })).toThrow(/already retired/);
    expect(() => retireLeaf([], placed, { ...base, id: "components.a", replacedBy: "sections.c" })).toThrow(/another layer/);
    expect(() => retireLeaf([{ id: "components.b", retiredAt: at }], placed, { ...base, id: "components.a", replacedBy: "components.b" })).toThrow(/is retired/);
    expect(() => retireLeaf([{ id: "components.a", retiredAt: at, replacedBy: "components.b" }], placed, { ...base, id: "components.b" })).toThrow(/replacement of a retired leaf/);
    expect(() => retireLeaf([], placed, { ...base, id: "components.a", at: "soon" })).toThrow(/YYYY-MM-DD/);
    expect(() => retireLeaf([], placed, { id: "components.a", by: "", reason: "x", at })).toThrow(/required/);
  });

  it("reads placements from the committed IA trees", () => {
    const real = placedLeaves();
    expect(real.get("components.button")).toBe("components");
    expect(real.get("sections.newsletter")).toBe("sections");
  });
});
