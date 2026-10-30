import type { CatalogData } from "../types.js";

/** Token-only unit tests declare completeness within this explicit registry view. */
export function tokenCatalog(catalog: CatalogData): CatalogData {
  return { ...catalog, slots: catalog.slots.filter(slot => slot.layer === "tokens"), fills: catalog.fills.filter(fill => !!fill.tokens), placements: catalog.placements.filter(placement => placement.layer === "tokens"), rules: catalog.rules?.filter(rule => rule.slot.startsWith("tokens.")) };
}
