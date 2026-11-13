/**
 * Studio boards show only the sources the library roster offers (`catalog/rules/source-roster.json`), so the
 * SYNTHETIC component corpus's unlisted "test-kit" source never gets a column, and a catalog draft is never offered
 * for adoption. These helpers move that SYNTHETIC fill onto an offered source with a stable status, exactly as the
 * library-board Section tests do; checks, evidence and change shapes are otherwise unchanged. No conformance or
 * provenance claim for the offered source.
 */
import { applyLibraryChange, libraryHash } from "../../catalog-core/index.js";
import { componentIntegration } from "../../catalog-core/__fixtures__/component-integration.js";
import type { CompositeCatalogData, CompositeEngineInput } from "../../catalog-core/types.js";

/** The roster-offered source the SYNTHETIC button fill is shown under. */
export const OFFERED_SOURCE = "shadcn@aria";
const SYNTHETIC_SOURCE = "test-kit";

/** The catalog with its SYNTHETIC "test-kit" component fills renamed to the offered source. */
export function offeredCatalog<T extends CompositeCatalogData>(catalog: T): T {
  const fills = catalog.components.fills.map(doc => {
    if (doc.$extensions["com.clossys.fill"].source !== SYNTHETIC_SOURCE) return doc;
    const copy = structuredClone(doc), meta = copy.$extensions["com.clossys.fill"];
    meta.source = OFFERED_SOURCE; meta.id = meta.id.replace(SYNTHETIC_SOURCE, OFFERED_SOURCE); meta.status = "stable";
    for (const candidate of Object.values(copy.components)) if (candidate.source === SYNTHETIC_SOURCE) candidate.source = OFFERED_SOURCE;
    return copy;
  });
  return { ...catalog, components: { ...catalog.components, fills } };
}
/** `componentIntegration()` with its button fill offered on the board. */
export function offeredComponentIntegration(): CompositeEngineInput {
  const input = componentIntegration();
  return { ...input, catalog: offeredCatalog(input.catalog) };
}
/** `adoptedComponentIntegration()` with the adopted button fill on the offered source. */
export function adoptedOfferedComponentIntegration(): CompositeEngineInput {
  const input = offeredComponentIntegration();
  return { ...input, library: applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "components", change: { op: "adopt", slot: "components.button", source: OFFERED_SOURCE } }] }) };
}
