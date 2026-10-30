/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { emitComposite, resolveComposite } from "../catalog-core/library-components.js";
import type { CompositeEngineInput } from "../catalog-core/types.js";
import type { SurfaceResolutionOptions } from "../catalog-core/surface-types.js";
import { compileSurfaceLibrary, saveSurfaceLibrary, syntheticSurfacePair } from "./__fixtures__/surface-library.js";
import { compileLibraryCells, libraryToCells } from "./cells.js";
import { readLibrary, readLibraryFromCells } from "./fs-library.js";

let temporary: string, source: string, cells: string, output: string, engine: CompositeEngineInput;
let sequence = 0;
const readJson = async (path: string) => JSON.parse(await fs.readFile(path, "utf8"));
beforeAll(async () => {
  temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "designer-cell-observations-")));
  source = join(temporary, "source");
  const input = syntheticSurfacePair();
  await saveSurfaceLibrary(source, input);
  // An actual compiler and module invocation qualify only this SYNTHETIC fixture.
  engine = (await compileSurfaceLibrary(source, input)).input;
}, 30_000);
beforeEach(() => { cells = join(temporary, `cells-${++sequence}`); output = join(temporary, `output-${sequence}`); });
afterAll(async () => { await fs.rm(temporary, { recursive: true, force: true }); });

async function migrate(surfaceOptions = engine.surfaceOptions) {
  await libraryToCells(source, cells, { catalog: engine.catalog, surfaceOptions, date: "2026-10-30" });
}
async function stored(): Promise<SurfaceResolutionOptions> {
  return (await readJson(join(cells, "tree.json"))).meta.surfaceOptions;
}

it("preserves independently measured surface observations through cells and their compiled library", async () => {
  await migrate();
  expect(await stored()).toEqual(engine.surfaceOptions);
  const before = await fs.readFile(join(cells, "tree.json"), "utf8");
  await compileLibraryCells(cells, output, { catalog: engine.catalog });
  const observations = await readJson(join(output, "surface-observations.json"));
  expect(observations).toEqual(engine.surfaceOptions);
  const library = await readLibraryFromCells(cells, engine.catalog);
  expect(resolveComposite({ ...engine, library, surfaceOptions: observations }).check.ok).toBe(true);
  expect(await fs.readFile(join(cells, "tree.json"), "utf8")).toBe(before);
  const migrated = join(temporary, "remigrated");
  await libraryToCells(output, migrated, { catalog: engine.catalog, date: "2026-10-30" });
  expect((await readJson(join(migrated, "tree.json"))).meta.surfaceOptions).toEqual(observations);
});

it.each(["source", "identity", "compiler"] as const)("keeps stale %s observations unqualified at use time", async kind => {
  await migrate();
  const tree = await readJson(join(cells, "tree.json"));
  const measurement = tree.meta.surfaceOptions.measurements[0];
  if (kind === "source") measurement.source.files[measurement.source.entry] += "\n// changed measured bytes\n";
  if (kind === "identity") measurement.identity.outputHash = `sha256:${"0".repeat(64)}`;
  if (kind === "compiler") measurement.compiler.sourceHash = `sha256:${"0".repeat(64)}`;
  await fs.writeFile(join(cells, "tree.json"), JSON.stringify(tree));
  await compileLibraryCells(cells, output, { catalog: engine.catalog });
  const library = await readLibrary(output, engine.catalog);
  const profile = resolveComposite({ ...engine, library, surfaceOptions: await readJson(join(output, "surface-observations.json")) });
  expect(profile.check.ok).toBe(false);
  expect(profile.surfaces!.check.findings.some(finding => finding.code === "S8" && finding.severity === "error")).toBe(true);
  expect(() => emitComposite(profile, ["surface-index"])).toThrow();
});

it("rejects an unsupported observation version before creating a migration destination", async () => {
  const observations = structuredClone(engine.surfaceOptions!);
  (observations.measurements[0] as { version: number }).version = 2;
  await expect(migrate(observations)).rejects.toThrow();
  await expect(fs.access(cells)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["null", "unknown key", "duplicate package"] as const)("rejects %s stored observations even when the caller supplies an override", async kind => {
  await migrate();
  const tree = await readJson(join(cells, "tree.json"));
  if (kind === "null") tree.meta.surfaceOptions = null;
  if (kind === "unknown key") tree.meta.surfaceOptions.unchecked = true;
  if (kind === "duplicate package") {
    const evidence = { module: "@example/surface-fixture", version: "1.0.0", artifactSha256: "a".repeat(64), values: [], types: [] };
    tree.meta.surfaceOptions.packages.push(evidence, evidence);
  }
  await fs.writeFile(join(cells, "tree.json"), JSON.stringify(tree));
  await expect(compileLibraryCells(cells, output, { catalog: engine.catalog, surfaceOptions: engine.surfaceOptions })).rejects.toThrow();
  await expect(fs.access(output)).rejects.toMatchObject({ code: "ENOENT" });
});
