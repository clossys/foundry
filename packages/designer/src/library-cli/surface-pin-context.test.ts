// @vitest-environment node
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it } from "vitest";
import { activate, propose } from "@clossys/strategist/cell-format";
import { applyLibraryChange, libraryHash, loadCatalog } from "../catalog-core/index.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import { isSurfacePackageEntry, surfaceEntryOf, surfacePackageDescriptorHash } from "../catalog-core/surface-library.js";
import type { CompositeCatalogData, CompositeLibraryData } from "../catalog-core/types.js";
import type { SurfacePackageDocument } from "../catalog-core/surface-types.js";
import { foundrySurfaceCatalog } from "./surface-catalog.js";
import { libraryFiles, readLibrary, readLibraryFromCells } from "./fs-library.js";
import { compileLibraryCells, libraryToCells, runCellsCli } from "./cells.js";

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
  const input = join(root, "library"), cells = join(root, "authored"), output = join(root, "projection");
  for (const [name, content] of libraryFiles(foreignCatalog, library, [], undefined, { packages: [], measurements: [] })) {
    await fs.mkdir(dirname(join(input, name)), { recursive: true }); await fs.writeFile(join(input, name), content);
  }
  await libraryToCells(input, cells, { catalog: foreignCatalog, date: "2026-10-30" });
  const draft = await propose(cells, slot);
  await activate(cells, ["frames.app-shell@2"], { confirm: "msg:public-example#U1" });
  expect(draft.path).toBe(`cells/${slot}/v2.md`);
  return { input, cells, output, active: join(cells, draft.path) };
}

it("unknown public package pin stays refused and identifies the actual compiled input and slot", async () => {
  const { input } = await fixture();
  const entry = surfaceEntryOf(library.surfaces!.fills[0]!);
  const current = surfaceEntryOf(catalog.surfaces!.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === slot)!);
  if (!isSurfacePackageEntry(entry) || !isSurfacePackageEntry(current)) throw new Error("Expected public package descriptors");
  expect(surfacePackageDescriptorHash(entry)).not.toBe(surfacePackageDescriptorHash(current));
  await expect(readLibrary(input, catalog)).rejects.toThrow(`${join(input, `fills/${slot}.json`)}: slot ${slot}: surfaces: S2 unique registered historical upstream required`);
});

it("native migration, active v2 compilation and real cell reader report the actual cell path and slot", async () => {
  const { cells, output, active } = await fixture();
  const before = await fs.readFile(active, "utf8");
  await expect(compileLibraryCells(cells, output, { catalog, surfaceOptions: { packages: [], measurements: [] } })).rejects.toThrow(`${active}: slot ${slot}: surfaces: S2 unique registered historical upstream required`);
  await expect(readLibraryFromCells(cells, catalog)).rejects.toThrow(`${active}: slot ${slot}: surfaces: S2 unique registered historical upstream required`);
  // CLI compilation uses the same public native profile and prints that same context.
  const errors: string[] = [];
  expect(await runCellsCli(["compile", "--root", cells, "--out", output], { out: () => {}, error: text => errors.push(text) })).toBe(2);
  expect(errors.join("\n")).toContain(`${active}: slot ${slot}: surfaces: S2`);
  const installed = spawnSync(process.execPath, [fileURLToPath(new URL("../../dist/library-cli/cli.js", import.meta.url)), "cells", "compile", "--root", cells, "--out", output], { encoding: "utf8", timeout: 60_000 });
  expect(installed.error).toBeUndefined();
  expect(installed.status).toBe(2);
  expect(installed.stderr).toContain(`${active}: slot ${slot}: surfaces: S2`);
  expect(await fs.readFile(active, "utf8")).toBe(before);
});
