/** Test-only consumer closure: real producer candidates and explicit public adoption. */
import { readFileSync } from "node:fs";
import { importFoundryComponents } from "../../../importers/foundry-components.js";
import { packageBarrelExports } from "../../../library-cli/surface-package-evidence.js";
import { applyLibraryChange, libraryHash } from "../../api.js";
import { componentOf } from "../../resolve-components.js";
import { isSurfacePackageEntry, surfaceEntryOf } from "../../surface-library.js";
import { completedCatalogLibrary } from "../completed-catalog-library.js";
import type { CompositeCatalogData, CompositeLibraryData } from "../../types.js";

export function selectedPackageComponentOptions() {
  const exportsOf = (path: string) => packageBarrelExports(readFileSync(new URL(path, import.meta.url), "utf8")).values;
  return { packageExports: {
    "@clossys/designer/components": exportsOf("../../../components/index.ts"),
    "@clossys/designer/charts": exportsOf("../../../charts/index.ts"),
    "@clossys/designer/shell": exportsOf("../../../shell/index.ts"),
  } };
}

/** Includes only the components each supplied surface declares, and their actual dependencies. */
export function selectedPackageClosure(catalog: CompositeCatalogData) {
  const values = completedCatalogLibrary(catalog.values, { id: "selected-package", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-26");
  const { source, adoptedAt, ...portion } = values;
  const empty: CompositeLibraryData = { source, adoptedAt, values: portion, components: { fills: [], files: [] } };
  const candidates = new Map(importFoundryComponents().fills.map(doc => [doc.$extensions["com.clossys.fill"].slot, doc]));
  const selected = new Set<string>(), visiting = new Set<string>(), ordered: string[] = [];
  const visit = (id: string) => {
    if (!id.startsWith("components.") || selected.has(id)) return;
    if (visiting.has(id)) throw new Error(`Test closure component cycle: ${id}`);
    const doc = candidates.get(id);
    if (!doc) throw new Error(`Test closure component candidate missing: ${id}`);
    visiting.add(id);
    const component = componentOf(doc);
    for (const dependency of [...component.reads.components, ...component.composes]) visit(dependency);
    visiting.delete(id);
    selected.add(id);
    ordered.push(id);
  };
  if (!catalog.surfaces) throw new Error("Test closure requires an explicit surface catalog");
  for (const doc of catalog.surfaces.fills) {
    const entry = surfaceEntryOf(doc);
    if (!isSurfacePackageEntry(entry) || !entry.reads || !entry.composes || !entry.consumption)
      throw new Error(`Test closure requires measured package metadata: ${entry.slot}`);
    for (const id of entry.composes) visit(id);
  }
  const componentOptions = selectedPackageComponentOptions();
  const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: ordered.map(slot => ({ portion: "components", change: { op: "adopt", slot, source: "foundry" } })) });
  return { library, componentOptions };
}
