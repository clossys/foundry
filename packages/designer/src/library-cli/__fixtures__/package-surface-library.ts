/** A consumer library that adopted every planned Foundry Section and Frame default as a package pointer, on the real catalog the CLI assembles. */
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applyLibraryChange, libraryHash } from "../../catalog-core/api.js";
import { completedCatalogLibrary } from "../../catalog-core/__fixtures__/completed-catalog-library.js";
import { loadBuildCatalog, loadCatalog, loadComponentRegistry, loadSectionRegistry } from "../../catalog-core/index.js";
import { planSurfaceDefaults, type SurfaceDefaultCandidateDocument } from "../../catalog-core/surface-defaults.js";
import type { SurfaceCandidateDocument, SurfacePackageEvidence, SurfaceResolutionOptions } from "../../catalog-core/surface-types.js";
import type { CompositeCatalogData, CompositeLibraryData, FrameSlot } from "../../catalog-core/types.js";
import { importFoundryFrames } from "../../importers/foundry-frames.js";
import { importFoundrySections } from "../../importers/foundry-sections.js";
import { libraryFiles, readLibrary } from "../fs-library.js";
import { readSurfacePackageEvidence } from "../surface-package-evidence.js";

export interface PackageSurfaceLibrary {
  catalog: CompositeCatalogData;
  library: CompositeLibraryData;
  packages: SurfacePackageEvidence[];
  options: SurfaceResolutionOptions;
  decisions: readonly { slot: string; source: string }[];
}
export async function packageSurfaceLibrary(): Promise<PackageSurfaceLibrary> {
  const fills = [...importFoundrySections().fills, ...importFoundryFrames().fills] as unknown as SurfaceCandidateDocument[];
  const slots = [...loadSectionRegistry().slots, ...loadBuildCatalog().slots.filter((slot): slot is FrameSlot => slot.layer === "frames")];
  const catalog: CompositeCatalogData = { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: [] }, surfaces: { slots, fills, transforms: [], rules: [], materializations: [] } };
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
  const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: decisions.map(row => ({ portion: "surfaces" as const, change: { op: "adopt" as const, slot: row.slot as `sections.${string}`, source: row.source } })) }, { surfaceOptions: options });
  return { catalog, library, packages, options, decisions };
}
