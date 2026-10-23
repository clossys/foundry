import type { CatalogData, ChangeSet, CheckResult, EmitFile, EmitOptions, EmitTarget, LibraryData, Resolved, Selection } from "../catalog-core/index.js";
import * as demo from "./demo-engine.js";

/** The calls the Studio makes. It is the one seam between the Studio and an engine, written to the signatures in `catalog-core/api.ts`. */
export interface StudioEngine {
  loadCatalog(): CatalogData;
  resolve(input: { catalog: CatalogData; library: LibraryData; selection: Selection }): Resolved;
  check(input: { catalog: CatalogData; library: LibraryData; selection: Selection; resolved?: Resolved }): CheckResult;
  emit(resolved: Resolved, targets: readonly EmitTarget[], options?: EmitOptions): EmitFile[];
  applyChangeSet(selection: Selection, changes: ChangeSet): Selection;
  selectionHash(selection: Selection): string;
}

/**
 * The engine the Studio uses today: the throwaway demo engine. When the real `resolve`, `check` and `emit` land, the later
 * swap ticket points this constant at `../catalog-core/index.js` and deletes `demo-engine.ts` and `demo-data.ts`.
 */
export const studioEngine: StudioEngine = demo;
