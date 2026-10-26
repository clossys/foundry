// @vitest-environment node
/** Host wiring for package-pointer Sections and Frames: persist, load, check, emit and the CLI, on the real catalog. */
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { compositeLibraryHash } from "../catalog-core/library-components.js";
import type { SurfaceResolutionOptions } from "../catalog-core/surface-types.js";
import type { CompositeCatalogData, CompositeLibraryData } from "../catalog-core/types.js";
import { packageSurfaceLibrary } from "./__fixtures__/package-surface-library.js";
import { main } from "./cli.js";
import { checkLibrary, emitLibrary, libraryFiles, readLibrary } from "./fs-library.js";

let catalog: CompositeCatalogData, options: SurfaceResolutionOptions, library: CompositeLibraryData, decisions: readonly { slot: string; source: string }[];
let temporary: string, root: string;

beforeAll(async () => { ({ catalog, library, options, decisions } = await packageSurfaceLibrary()); }, 120_000);
beforeEach(async () => { temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "surface-package-library-"))); root = join(temporary, "library"); });
afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
async function save(files: ReadonlyMap<string, string>): Promise<void> {
  await fs.mkdir(join(root, "fills"), { recursive: true });
  for (const [name, content] of files) { await fs.mkdir(dirname(join(root, name)), { recursive: true }); await fs.writeFile(join(root, name), content); }
}
async function cli(...args: string[]) {
  const out: string[] = [], error: string[] = [];
  const code = await main([...args, "--root", root], { out: text => out.push(text), error: text => error.push(text) });
  return { code, out: out.join("\n"), error: error.join("\n") };
}

describe("package-pointer surfaces on disk", { timeout: 120_000 }, () => {
  it("persists every adopted pointer as a fill with no owned files, and emits its package re-export", async () => {
    expect(decisions.length).toBeGreaterThan(0);
    const files = libraryFiles(catalog, library, undefined, undefined, options);
    for (const row of decisions) expect(files.has(`fills/${row.slot}.json`), row.slot).toBe(true);
    expect(JSON.parse(files.get("metadata.json")!).surfaces).toEqual({ version: 1, files: [] });
    expect(files.get("sections/faq/index.ts")).toMatch(/export \{ Faq(?: as Faq)? \} from "@clossys\/designer\/blocks";/);
    expect(files.get("index.ts")).toContain('from "./fills/sections.faq.json"');
  });

  it("round-trips the persisted library through the disk reader unchanged", async () => {
    await save(libraryFiles(catalog, library, undefined, undefined, options));
    const read = await readLibrary(root, catalog);
    expect(read.surfaces!.fills).toHaveLength(decisions.length);
    expect(compositeLibraryHash(read)).toBe(compositeLibraryHash(library));
  });

  it("checks clean with host package evidence: the runtime rule is a notice, missing evidence is an error", async () => {
    await save(libraryFiles(catalog, library, undefined, undefined, options));
    const surfaces = (await checkLibrary(root, catalog, undefined, options)).findings.filter(row => row.rule === "surfaces");
    expect(surfaces.filter(row => row.severity === "error")).toEqual([]);
    expect(surfaces.some(row => row.severity === "notice" && /package pointer/.test(row.message))).toBe(true);
    const unsupported = (await checkLibrary(root, catalog, undefined, { packages: [], measurements: [] })).findings.filter(row => row.rule === "surfaces" && row.severity === "error");
    expect(unsupported.some(row => /package export evidence missing or differs/.test(row.message))).toBe(true);
    expect(await emitLibrary(root, catalog, { check: true, surfaceOptions: options })).toEqual({ ok: true, drift: [] });
  });

  it("the CLI checks and emits a package-adopted library against the installed package barrels", async () => {
    await save(libraryFiles(catalog, library, undefined, undefined, options));
    for (const layer of ["sections", "frames"]) {
      const result = await cli("check", "--layer", layer, "--json");
      expect(result.error, layer).toBe("");
      expect(result.code, layer).toBe(0);
    }
    expect((await cli("emit", "--check")).code).toBe(0);
    expect(JSON.parse((await cli("status", "--json")).out).slots).toEqual(expect.arrayContaining(decisions.map(row => row.slot)));
  });

  it("the CLI applies a package adoption changeset with host evidence", async () => {
    const one = { ...library, surfaces: { version: 1 as const, fills: library.surfaces!.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot !== "sections.faq"), files: [] } };
    await save(libraryFiles(catalog, one, undefined, undefined, options));
    const changeset = join(temporary, "adopt.json");
    await fs.writeFile(changeset, JSON.stringify({ baseHash: compositeLibraryHash(await readLibrary(root, catalog)), changes: [{ portion: "surfaces", change: { op: "adopt", slot: "sections.faq", source: "foundry" } }] }));
    const result = await cli("apply", "--changeset", changeset, "--json");
    expect(result.error).toBe("");
    expect(result.code).toBe(0);
    expect((await readLibrary(root, catalog)).surfaces!.fills.some(doc => doc.$extensions["com.clossys.fill"].slot === "sections.faq")).toBe(true);
  });
});
