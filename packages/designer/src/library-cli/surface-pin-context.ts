import { isSurfacePackageEntry, surfaceEntryOf, verifySurfacePackageProvenance } from "../catalog-core/surface-library.js";
import type { CompositeCatalogData } from "../catalog-core/types.js";
import type { SurfaceDocument } from "../catalog-core/surface-types.js";

/** Validate the real package provenance before losing the authored input location. */
export function verifySurfacePackageInputs(catalog: CompositeCatalogData, documents: readonly SurfaceDocument[], inputPath: (slot: string) => string): void {
  for (const document of documents) {
    const entry = surfaceEntryOf(document);
    if (!isSurfacePackageEntry(entry)) continue;
    try { verifySurfacePackageProvenance(catalog, entry); }
    catch (error) {
      throw new Error(`${inputPath(entry.slot)}: slot ${entry.slot}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
}
