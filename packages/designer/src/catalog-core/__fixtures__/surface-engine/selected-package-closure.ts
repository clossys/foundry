/** Test-only consumer closure: real producer candidates and explicit public adoption. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalogBundles } from "../../../catalog-bundles.js";
import { importFoundryComponents } from "../../../importers/foundry-components.js";
import { packageBarrelExports } from "../../../library-cli/surface-package-evidence.js";
import { applyLibraryChange, libraryHash } from "../../api.js";
import { componentOf } from "../../resolve-components.js";
import { isSurfacePackageEntry, surfaceEntryOf } from "../../surface-library.js";
import { completedCatalogLibrary } from "../completed-catalog-library.js";
import type { CompositeCatalogData, CompositeLibraryData } from "../../types.js";

export function selectedPackageComponentOptions() {
  // Read the barrels from package src/ both from src/ and from the compiled dist/ copy that other packages import.
  const src = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "src");
  const exportsOf = (path: string) => packageBarrelExports(readFileSync(join(src, path), "utf8")).values;
  return { packageExports: {
    "@clossys/designer/components": exportsOf("components/index.ts"),
    "@clossys/designer/charts": exportsOf("charts/index.ts"),
    "@clossys/designer/shell": exportsOf("shell/index.ts"),
  } };
}

/** Foundry component candidates plus the selected stock source (shadcn@aria) for every component Foundry does not
 * supply, as the shipped selection does; stock fills come with their materialized source bundles. */
export function selectedComponentFills(): CompositeCatalogData["components"]["fills"] {
  const foundry = importFoundryComponents().fills;
  const covered = new Set(foundry.map(doc => doc.$extensions["com.clossys.fill"].slot));
  const stock = loadCatalogBundles().componentFills.filter(doc => doc.$extensions["com.clossys.fill"].source === "shadcn@aria" && !covered.has(doc.$extensions["com.clossys.fill"].slot));
  return [...foundry, ...stock] as unknown as CompositeCatalogData["components"]["fills"];
}

/** The components the supplied surfaces declare, with their actual dependencies, in install order (dependency first). */
export function selectedComponentClosure(catalog: CompositeCatalogData): string[] {
  const candidates = new Map(catalog.components.fills.map(doc => [doc.$extensions["com.clossys.fill"].slot, doc]));
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
  return ordered;
}

/** Adoption changes for a component closure, each from its candidate's own source. */
export function componentAdoptions(catalog: CompositeCatalogData, ordered: readonly string[]) {
  const source = new Map(catalog.components.fills.map(doc => [doc.$extensions["com.clossys.fill"].slot, doc.$extensions["com.clossys.fill"].source]));
  return ordered.map(slot => ({ portion: "components" as const, change: { op: "adopt" as const, slot, source: source.get(slot)! } }));
}

/** Export inventories of the installed packages that materialized source files import, read from the installed modules
 * themselves (never listed by hand); Foundry's own barrels come from selectedPackageComponentOptions. */
export async function installedSourceImportExports(files: readonly { path: string; content: string }[]): Promise<Record<string, string[]>> {
  const specifiers = new Set<string>();
  for (const file of files) for (const match of file.content.matchAll(/\bfrom\s*["']([^"'./][^"']*)["']/g)) specifiers.add(match[1]!);
  const exports: Record<string, string[]> = {};
  for (const specifier of [...specifiers].sort()) if (!specifier.startsWith("@clossys/designer")) exports[specifier] = Object.keys(await import(specifier)).sort();
  return exports;
}

/** Includes only the components each supplied surface declares, and their actual dependencies. */
export function selectedPackageClosure(catalog: CompositeCatalogData) {
  const values = completedCatalogLibrary(catalog.values, { id: "selected-package", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-26");
  const { source, adoptedAt, ...portion } = values;
  const empty: CompositeLibraryData = { source, adoptedAt, values: portion, components: { fills: [], files: [] } };
  const ordered = selectedComponentClosure(catalog);
  const componentOptions = selectedPackageComponentOptions();
  const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: componentAdoptions(catalog, ordered), bundles: loadCatalogBundles().sourceBundles });
  return { library, componentOptions };
}
