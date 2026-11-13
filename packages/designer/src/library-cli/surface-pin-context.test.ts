// @vitest-environment node
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeAll, expect, it } from "vitest";
import { applyLibraryChange, libraryHash, loadCatalog } from "../catalog-core/index.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import { isSurfacePackageEntry, surfaceEntryOf, surfacePackageDescriptorHash } from "../catalog-core/surface-library.js";
import type { CompositeCatalogData, CompositeLibraryData } from "../catalog-core/types.js";
import type { SurfacePackageDocument } from "../catalog-core/surface-types.js";
import { foundrySurfaceCatalog } from "./surface-catalog.js";
import { libraryFiles, readLibrary } from "./fs-library.js";

const slot = "frames.app-shell";
let catalog: CompositeCatalogData, foreignCatalog: CompositeCatalogData, library: CompositeLibraryData;
beforeAll(() => {
  catalog = { values: loadCatalog(), components: { slots: [], fills: [] }, surfaces: foundrySurfaceCatalog() };
  foreignCatalog = { ...catalog, surfaces: { ...catalog.surfaces!, fills: structuredClone(catalog.surfaces!.fills) } };
  const document = foreignCatalog.surfaces!.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === slot)!;
  const descriptor = (document as unknown as SurfacePackageDocument).frames!["app-shell"]!;
  // Entirely public source: a distinct descriptor is genuine only in this fixture catalog.
  descriptor.consumption!.sourceFiles![0]!.sha256 = "0".repeat(64);
  const values = completedCatalogLibrary(catalog.values, { id: "pin-context-example", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-30");
  const empty: CompositeLibraryData = { source: values.source, adoptedAt: "2026-10-30", values: { fills: values.fills }, components: { fills: [], files: [] }, surfaces: { version: 1, fills: [], files: [] } };
  library = applyLibraryChange(foreignCatalog, empty, { baseHash: libraryHash(empty), changes: [{ portion: "surfaces", change: { op: "adopt", slot, source: "foundry" } }] }, { surfaceOptions: { packages: [], measurements: [] } });
});

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "designer-pin-context-")));
  const input = join(root, "library");
  for (const [name, content] of libraryFiles(foreignCatalog, library, [], undefined, { packages: [], measurements: [] })) {
    await fs.mkdir(dirname(join(input, name)), { recursive: true }); await fs.writeFile(join(input, name), content);
  }
  return { input };
}

it("unknown public package pin stays refused and identifies the actual compiled input and slot", async () => {
  const { input } = await fixture();
  const entry = surfaceEntryOf(library.surfaces!.fills[0]!);
  const current = surfaceEntryOf(catalog.surfaces!.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === slot)!);
  if (!isSurfacePackageEntry(entry) || !isSurfacePackageEntry(current)) throw new Error("Expected public package descriptors");
  expect(surfacePackageDescriptorHash(entry)).not.toBe(surfacePackageDescriptorHash(current));
  await expect(readLibrary(input, catalog)).rejects.toThrow(`${join(input, `fills/${slot}.json`)}: slot ${slot}: surfaces: S2 unique registered historical upstream required`);
});
