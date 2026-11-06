/** A consumer library that adopted every planned Foundry Section and Frame default as a package pointer, on the real catalog the CLI assembles. */
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applyLibraryChange, libraryHash } from "../../catalog-core/api.js";
import { componentOf } from "../../catalog-core/resolve-components.js";
import { surfaceEntryOf } from "../../catalog-core/surface-library.js";
import { completedCatalogLibrary } from "../../catalog-core/__fixtures__/completed-catalog-library.js";
import { selectedPackageComponentOptions, installedSourceImportExports } from "../../catalog-core/__fixtures__/surface-engine/selected-package-closure.js";
import { loadBuildCatalog, loadCatalog, loadComponentRegistry, loadSectionRegistry } from "../../catalog-core/index.js";
import { planSurfaceDefaults, type SurfaceDefaultCandidateDocument } from "../../catalog-core/surface-defaults.js";
import type { SurfaceCandidateDocument, SurfacePackageEvidence, SurfaceResolutionOptions } from "../../catalog-core/surface-types.js";
import type { CompositeCatalogData, CompositeEngineInput, CompositeLibraryData, FrameSlot } from "../../catalog-core/types.js";
import { importFoundryComponents } from "../../importers/foundry-components.js";
import { loadCatalogBundles } from "../../catalog-bundles.js";
import { importFoundryFrames } from "../../importers/foundry-frames.js";
import { importFoundrySections } from "../../importers/foundry-sections.js";
import { libraryFiles, readLibrary } from "../fs-library.js";
import { readSurfacePackageEvidence } from "../surface-package-evidence.js";

export interface PackageSurfaceLibrary {
  catalog: CompositeCatalogData;
  library: CompositeLibraryData;
  packages: SurfacePackageEvidence[];
  options: SurfaceResolutionOptions;
  /** Package-export evidence for the selected package components, shaped like a persisted component-observations.json. */
  componentOptions: NonNullable<CompositeEngineInput["componentOptions"]>;
  decisions: readonly { slot: string; source: string }[];
}
export async function packageSurfaceLibrary(): Promise<PackageSurfaceLibrary> {
  const fills = [...importFoundrySections().fills, ...importFoundryFrames().fills] as unknown as SurfaceCandidateDocument[];
  const slots = [...loadSectionRegistry().slots, ...loadBuildCatalog().slots.filter((slot): slot is FrameSlot => slot.layer === "frames")];
  // Components with no Foundry candidate come from the selected stock source (shadcn@aria) with its materialized
  // source bundle, as the shipped selection does; every other component stays a Foundry package pointer.
  const foundryComponents = importFoundryComponents().fills;
  const covered = new Set(foundryComponents.map(doc => doc.$extensions["com.clossys.fill"].slot));
  const bundles = loadCatalogBundles();
  const stockComponents = bundles.componentFills.filter(doc => doc.$extensions["com.clossys.fill"].source === "shadcn@aria" && !covered.has(doc.$extensions["com.clossys.fill"].slot));
  const catalog: CompositeCatalogData = { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: [...foundryComponents, ...stockComponents] as unknown as CompositeCatalogData["components"]["fills"] }, surfaces: { slots, fills, transforms: [], rules: [], materializations: [] } };
  const packages = await readSurfacePackageEvidence(fills);
  const options: SurfaceResolutionOptions = { packages, measurements: [] };
  const decisions = planSurfaceDefaults({ catalog: { slots, fills: fills as unknown as SurfaceDefaultCandidateDocument[] }, slots: slots.map(slot => slot.id), preference: ["foundry"] }).decisions;
  const values = completedCatalogLibrary(catalog.values, { id: "package-consumer", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-26");
  const opted: CompositeLibraryData = { source: values.source, adoptedAt: "2026-10-26", values: { fills: values.fills, complete: values.complete }, components: { fills: [], files: [] }, surfaces: { version: 1, fills: [], files: [] } };
  // Start from what the disk reader returns for that library, exactly as a host adopting into an existing library does.
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "package-surface-library-")));
  let empty: CompositeLibraryData;
  try {
    for (const [name, content] of libraryFiles(catalog, opted, [])) { await fs.mkdir(dirname(join(root, name)), { recursive: true }); await fs.writeFile(join(root, name), content); }
    empty = await readLibrary(root, catalog);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
  // Select exactly the components the adopted surfaces compose, and their own dependencies, dependencies first.
  const candidates = new Map(catalog.components.fills.map(doc => [doc.$extensions["com.clossys.fill"].slot, doc]));
  const selected: string[] = [], visiting = new Set<string>();
  const visit = (id: string) => {
    if (!id.startsWith("components.") || selected.includes(id)) return;
    if (visiting.has(id)) throw new Error(`package-surface-library: component cycle ${id}`);
    const doc = candidates.get(id);
    if (!doc) throw new Error(`package-surface-library: component candidate missing ${id}`);
    visiting.add(id);
    const component = componentOf(doc);
    for (const dependency of [...component.reads.components, ...component.composes]) visit(dependency);
    visiting.delete(id);
    selected.push(id);
  };
  const adopted = new Set(decisions.map(row => row.slot));
  for (const doc of fills) { const entry = surfaceEntryOf(doc); if (adopted.has(entry.slot)) for (const id of entry.composes ?? []) visit(id); }
  const componentOptions = selectedPackageComponentOptions();
  const withComponents = selected.length ? applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: selected.map(slot => ({ portion: "components" as const, change: { op: "adopt" as const, slot, source: candidates.get(slot)!.$extensions["com.clossys.fill"].source } })), bundles: bundles.sourceBundles }, { componentOptions, surfaceOptions: options }) : empty;
  // Stock source files import their installed packages; observe those exports so emit closes over real modules.
  const installed = await installedSourceImportExports(withComponents.components.files);
  const emitOptions = { ...componentOptions, packageExports: { ...componentOptions.packageExports, ...installed } };
  const library = applyLibraryChange(catalog, withComponents, { baseHash: libraryHash(withComponents), changes: decisions.map(row => ({ portion: "surfaces" as const, change: { op: "adopt" as const, slot: row.slot as `sections.${string}`, source: row.source } })) }, { componentOptions: emitOptions, surfaceOptions: options });
  return { catalog, library, packages, options, componentOptions: emitOptions, decisions };
}
