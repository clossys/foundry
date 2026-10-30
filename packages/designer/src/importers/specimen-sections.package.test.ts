import { expect, it } from "vitest";
import * as sdk from "../studio/index.js";
import { loadSectionRegistry, planSurfaceDefaults } from "../catalog-core/index.js";
import { isSurfacePackageEntry, surfaceEntryOf } from "../catalog-core/surface-library.js";
import { specimenSectionPackageCatalog } from "./specimen-sections.package.js";
import { SPECIMEN_SECTION_EXPORTS, specimenSectionSourceCatalog } from "./specimen-sections.js";
import { canonicalSurfaceConsumption } from "./foundry-surface-consumption.js";

it("registers actual public SDK specimen functions as independently identified package implementations", () => {
  const fills = specimenSectionPackageCatalog();
  expect(fills).toHaveLength(14);
  for (const fill of fills) {
    const entry = surfaceEntryOf(fill), registered = SPECIMEN_SECTION_EXPORTS.find(row => row.id === entry.slot)!;
    expect(isSurfacePackageEntry(entry)).toBe(true);
    expect(entry.impl).toEqual({ kind: "package", module: "@clossys/designer/studio", export: registered.name });
    expect(typeof sdk[registered.name]).toBe("function");
    expect(fill.$extensions["com.clossys.fill"].pin).toEqual({ package: "@clossys/designer", version: "0.12.0", export: `./studio#${registered.name}` });
    expect(entry.consumption).toEqual(canonicalSurfaceConsumption(entry.slot, entry.impl, fill.$extensions["com.clossys.fill"].pin));
    expect(entry.consumption?.sourceFiles.length).toBeGreaterThan(0);
  }
});

it("plans the Publisher package leaf from its real contract and canonical observations while retaining source candidates independently", () => {
  const fills = specimenSectionPackageCatalog(), source = specimenSectionSourceCatalog();
  const ids = fills.map(fill => fill.$extensions["com.clossys.fill"].slot);
  const slots = loadSectionRegistry().slots.filter(slot => ids.includes(slot.id));
  const plan = planSurfaceDefaults({ catalog: { slots, fills }, slots: ids, preference: ["foundry"] });
  expect(plan.rows).toHaveLength(14);
  expect(plan.rows.find(row => row.slot === "sections.specimen-page-viewports")).toMatchObject({ status: "default", source: "foundry", reasons: [] });
  for (const row of plan.rows.filter(row => row.status === "not-chosen")) expect(row.reasons.length).toBeGreaterThan(0);
  expect(source.fills.every(fill => surfaceEntryOf(fill).impl.kind === "source")).toBe(true);
  expect(source.fills.every(fill => !Object.hasOwn(surfaceEntryOf(fill), "consumption"))).toBe(true);
});
