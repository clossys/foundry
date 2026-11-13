import type { CatalogData } from "../types.js";

/** Token-only unit tests declare completeness within this explicit registry view. */
export function tokenCatalog(catalog: CatalogData): CatalogData {
  return { ...catalog, slots: catalog.slots.filter(slot => slot.layer === "themes"), fills: catalog.fills.filter(fill => !!fill.themes), placements: catalog.placements.filter(placement => placement.layer === "themes"), rules: catalog.rules?.filter(rule => rule.slot.startsWith("themes.")) };
}
