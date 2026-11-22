import { completedCatalogLibrary } from "./completed-catalog-library.js";
import { consumptionReport, resolve, stableStringify, type CatalogData, type Source } from "../index.js";
import { compare } from "../model.js";

/** The consumer the completed-catalog goldens are materialized for. */
export const COMPLETED_CATALOG_SOURCE: Source = { id: "example-complete-catalog", kind: "consumer", author: "consumer", license: "MIT" };

/**
 * The two completed-catalog goldens, keyed by their `__golden__/` file name: the consumption report and
 * the materialized consumer coverage of the completed fixture library. completed-catalog.test.ts compares
 * them and scripts/generate-completed-catalog-goldens.mjs writes them, both through this one builder.
 */
export function completedCatalogGoldens(catalog: CatalogData, source: Source = COMPLETED_CATALOG_SOURCE): Record<"complete-consumption.json" | "complete-coverage.json", string> {
  const library = completedCatalogLibrary(catalog, source, "2026-10-23");
  const profile = resolve({ catalog, library }); const consumption = consumptionReport({ catalog, library });
  const leaves = catalog.slots.map(slot => {
    const members = Object.entries(profile.members).filter(([, member]) => member.slot === slot.id);
    return { slot: slot.id, members: members.length, sources: [...new Set(members.map(([, member]) => member.origin?.kind === "adopted" ? member.origin.source : source.id))].sort(compare), originKinds: [...new Set(members.map(([, member]) => member.origin?.kind))].sort(), rules: [...new Set(members.flatMap(([, member]) => member.origin?.kind === "derived" ? [member.origin.rule] : []))].sort(compare) };
  }).sort((a, b) => compare(a.slot, b.slot));
  const coverage = { kind: "materialized-consumer-coverage", consumer: source.id, complete: library.complete, slots: leaves.length, served: leaves.filter(leaf => leaf.members > 0).length, tokenLeaves: leaves.filter(leaf => leaf.slot.startsWith("themes.")).length, assetLeaves: leaves.filter(leaf => leaf.slot.startsWith("assets.")).length, boundProperties: Object.values(profile.members).filter(member => member.emit).length, leaves };
  return { "complete-consumption.json": stableStringify(consumption), "complete-coverage.json": stableStringify(coverage) };
}
