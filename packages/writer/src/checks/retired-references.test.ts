/**
 * No live read of a retired id (foundry-build-0033; IA audit 2026-11-16 proposal 9), each paired with a mutation.
 */
import { describe, expect, it } from "vitest";
import { checkRetiredReferences, loadRecordBundles, loadRetiredIds, retiredIdsIn, type RetiredReferenceBundle } from "./retired-references.js";

const retired = loadRetiredIds();
const bundles = loadRecordBundles();
const edit = (path: string, change: (doc: any) => void): RetiredReferenceBundle[] =>
  bundles.map(bundle => {
    if (bundle.path !== path) return bundle;
    const value = structuredClone(bundle.value);
    change(value);
    return { path, value };
  });
const messages = (list: RetiredReferenceBundle[]) => checkRetiredReferences(list, retired).map(finding => finding.message);

describe("retired references in Writer records", () => {
  it("loads the Designer retired registers and Writer's retired passages", () => {
    for (const id of ["sections.record-detail", "sections.legal-prose", "sections.logo-hero", "frames.document", "components.chart-heatmap", "passages.record-detail"]) {
      expect(retired.has(id), id).toBe(true);
    }
    expect(retired.has("sections.article")).toBe(false);
    expect(bundles.map(bundle => bundle.path)).toEqual(expect.arrayContaining(["admin-pages.r1.en.json", "admin-studio.r1.en.json", "section-defaults.r1.en.json", "site.en.json", "pending/sections-upgrade.r1.en.json"]));
  });

  it("matches whole ids only", () => {
    expect(retiredIdsIn("designer.frameOption.frames.document.variant.page", retired)).toEqual(["frames.document"]);
    expect(retiredIdsIn("designer.item.sections.cards-grid", new Set(["sections.cards"]))).toEqual([]);
    expect(retiredIdsIn("packages/designer/src/catalog/slots/sections.json", retired)).toEqual([]);
  });

  it("finds no live read of a retired id", () => {
    expect(checkRetiredReferences(bundles, retired)).toEqual([]);
  });

  it("keeps retired reads in place, flagged, rather than deleted", () => {
    const flagged = (path: string, key: "bindings" | "needs") =>
      (bundles.find(bundle => bundle.path === path)!.value as any)[key].filter((row: any) => row.status === "retired").length;
    expect(flagged("admin-pages.r1.en.json", "bindings")).toBe(8);
    expect(flagged("section-defaults.r1.en.json", "bindings")).toBe(4);
    expect(flagged("admin-studio.r1.en.json", "bindings")).toBe(41);
    expect(flagged("admin-studio.r1.en.json", "needs")).toBe(36);
    expect(flagged("admin-meta.r1.en.json", "bindings")).toBe(1);
    const sectionDefaults = (bundles.find(bundle => bundle.path === "section-defaults.r1.en.json")!.value as any).records;
    expect(sectionDefaults.filter((row: any) => row.status === "retired").map((row: any) => row.leaf).sort()).toEqual(["passages.logo-hero", "passages.record-detail"]);
    const site = (bundles.find(bundle => bundle.path === "site.en.json")!.value as any).records;
    expect(site.filter((row: any) => row.status === "retired").map((row: any) => row.leaf).sort()).toEqual([
      "passages.boundary-message", "passages.boundary-message", "passages.boundary-message", "passages.legal-prose", "passages.legal-prose", "passages.logo-hero",
    ]);
  });

  it("mutation: an unflagged binding to a retired section fails", () => {
    const list = edit("admin-pages.r1.en.json", doc => { delete doc.bindings.find((row: any) => row.target.startsWith("sections.record-detail.")).status; });
    expect(messages(list)).toEqual([expect.stringMatching(/^admin-pages\.r1\.en\.json#bindings\[\d+\]\.target binds retired sections\.record-detail/)]);
  });

  it("mutation: an unflagged Studio need for a retired item fails", () => {
    const list = edit("admin-studio.r1.en.json", doc => { doc.needs.find((row: any) => row.cellId === "designer.item.sections.logo-hero").status = "Need"; });
    expect(messages(list)).toEqual([expect.stringContaining("asks for retired sections.logo-hero")]);
  });

  it("mutation: a live block on the retired legal section or a draft record on a retired passage fails", () => {
    const block = edit("site.en.json", doc => {
      doc.records.find((row: any) => row.leaf === "narratives.legal-document").blocks[0].designer.id = "sections.legal-prose";
    });
    expect(messages(block)).toEqual([expect.stringContaining("designer.id reads retired sections.legal-prose")]);
    const record = edit("section-defaults.r1.en.json", doc => { doc.records.find((row: any) => row.leaf === "passages.record-detail").status = "draft"; });
    expect(messages(record)).toEqual(expect.arrayContaining([expect.stringContaining("leaf reads retired passages.record-detail")]));
  });
});
