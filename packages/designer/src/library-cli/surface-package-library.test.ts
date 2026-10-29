// @vitest-environment node
/** Host wiring for package-pointer Sections and Frames: persist, load, check, emit and the CLI, on the real catalog. */
import * as fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { surfaceEntryOf, surfacePackageDescriptorHash, surfacePackageDocument, surfaceContractDiff } from "../catalog-core/surface-library.js";
import type { SurfacePackageDocument, SurfacePackageEntry, SurfacePackageOrigin } from "../catalog-core/surface-types.js";
import { importFoundryFrames, importFoundrySections, loadBuildCatalog, loadSectionRegistry, loadFoundrySurfaceHistory, resolveSurfacePackageDescriptor } from "../catalog-core/index.js";
import { compositeLibraryHash } from "../catalog-core/library-components.js";
import type { SurfaceResolutionOptions } from "../catalog-core/surface-types.js";
import type { CompositeCatalogData, CompositeLibraryData, FrameSlot } from "../catalog-core/types.js";
import type { SurfaceCatalog, SurfaceCandidateDocument } from "../catalog-core/index.js";
import { packageSurfaceLibrary } from "./__fixtures__/package-surface-library.js";
import { main } from "./cli.js";
import { checkLibrary, emitLibrary, libraryFiles, readLibrary, writeCompositeLibrary } from "./fs-library.js";

let catalog: CompositeCatalogData, options: SurfaceResolutionOptions, library: CompositeLibraryData, decisions: readonly { slot: string; source: string }[];
let temporary: string, root: string;

beforeAll(async () => {
  ({ catalog, library, options, decisions } = await packageSurfaceLibrary());
  // A host assembles this entirely from the public catalog API, including the archive.
  const surfaces: SurfaceCatalog = {
    slots: [...loadSectionRegistry().slots, ...loadBuildCatalog().slots.filter((slot): slot is FrameSlot => slot.layer === "frames")],
    fills: [...importFoundrySections().fills, ...importFoundryFrames().fills] as unknown as SurfaceCandidateDocument[],
    transforms: [], rules: [], materializations: [], packageHistory: loadFoundrySurfaceHistory(),
  };
  catalog = { ...catalog, surfaces };
}, 120_000);
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
async function publicBin(...args: string[]) {
  const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
  const manifest = JSON.parse(await fs.readFile(join(packageRoot, "package.json"), "utf8")) as { bin: { "designer-library": string } };
  const result = spawnSync(process.execPath, [join(packageRoot, manifest.bin["designer-library"]), ...args, "--root", root], { encoding: "utf8", timeout: 60_000 });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return { code: result.status, out: result.stdout, error: result.stderr };
}

describe("package-pointer surfaces on disk", { timeout: 120_000 }, () => {

  async function staleFrame() {
    const oldCatalog = { ...catalog, surfaces: { ...catalog.surfaces!, fills: structuredClone(catalog.surfaces!.fills) } };
    const oldLibrary = structuredClone(library);
    const from = "sha256:b740aea8605c3bbbdb3f1c817031a0693965920b2efae0573c312f8c1043a4ed";
    const registration = loadFoundrySurfaceHistory()[from]![0]!;
    const candidate = registration.document as unknown as SurfacePackageDocument;
    const prior = surfaceEntryOf(oldLibrary.surfaces!.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "frames.app-shell")!) as SurfacePackageEntry & { origin: SurfacePackageOrigin };
    const held = surfacePackageDocument(oldLibrary, candidate.frames!["app-shell"]!, { ...prior.origin, pin: candidate.$extensions["com.clossys.fill"].pin!, descriptorHash: from });
    oldCatalog.surfaces.fills = oldCatalog.surfaces.fills.map(doc => doc.$extensions["com.clossys.fill"].slot === "frames.app-shell" ? candidate as never : doc);
    oldCatalog.surfaces.slots = oldCatalog.surfaces.slots.map(slot => slot.id === "frames.app-shell" ? registration.contract as never : slot);
    oldLibrary.surfaces!.fills = oldLibrary.surfaces!.fills.map(doc => doc.$extensions["com.clossys.fill"].slot === "frames.app-shell" ? held as never : doc);
    await save(libraryFiles(oldCatalog, oldLibrary, undefined, undefined, options));
    return { from, oldCatalog };
  }
  async function bytes() {
    const files = await fs.readdir(root, { recursive: true, withFileTypes: true });
    return Object.fromEntries(await Promise.all(files.filter(row => row.isFile()).map(async row => { const path = join(row.parentPath, row.name); return [path.slice(root.length + 1), (await fs.readFile(path)).toString("base64")]; })));
  }
  it("the public surfaces --refresh command persists a stale held frame, history and write receipt", async () => {
    const { from } = await staleFrame();
    expect((await cli("check", "--layer", "frames", "--json")).code).toBe(0);
    const result = await cli("surfaces", "--refresh", "frames.app-shell", "--json");
    expect(result.error).toBe(""); expect(result.code).toBe(0);
    const next = await readLibrary(root, catalog);
    const entry = surfaceEntryOf(next.surfaces!.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "frames.app-shell")!) as SurfacePackageEntry & { origin: { descriptorHash: string; history: unknown } };
    expect(entry.origin.history).toEqual([{ from, to: entry.origin.descriptorHash }]);
    expect((await cli("check", "--layer", "frames", "--json")).code).toBe(0);
    expect((await cli("emit", "--check")).code).toBe(0);
    expect((await cli("receipt", "--json")).code).toBe(0);
    const before = await bytes();
    expect((await cli("surfaces", "--refresh", "frames.app-shell")).code).toBe(0);
    expect(await bytes()).toEqual(before);
  });
  it("refused public refresh and CAS leave every persisted byte unchanged", async () => {
    await staleFrame();
    const before = await bytes(), current = await readLibrary(root, catalog);
    expect((await cli("surfaces", "--refresh", "frames.unknown")).code).not.toBe(0);
    await expect(writeCompositeLibrary(root, catalog, { baseHash: "sha256:" + "0".repeat(64), changes: [{ portion: "surfaces", change: { op: "refresh", slot: "frames.app-shell", source: "foundry" } }] }, undefined, options)).rejects.toThrow(/baseHash/);
    await expect(writeCompositeLibrary(root, catalog, { baseHash: compositeLibraryHash(current), changes: [{ portion: "surfaces", change: { op: "refresh", slot: "frames.app-shell", source: "foreign" } }] }, undefined, options)).rejects.toThrow(/source/);
    expect(await bytes()).toEqual(before);
  });
  it("a host using public importers and history persists an unrelated operation with the real b740 stale frame", async () => {
    const { from } = await staleFrame();
    const held = await readLibrary(root, catalog);
    expect((await checkLibrary(root, catalog, undefined, options)).findings).toContainEqual(expect.objectContaining({ code: "S2", severity: "notice", subject: "frames.app-shell", actualHash: from, expectedHash: expect.any(String), nextOperation: { op: "refresh", slot: "frames.app-shell", source: "foundry" } }));
    const next = await writeCompositeLibrary(root, catalog, { baseHash: compositeLibraryHash(held), changes: [{ portion: "surfaces", change: { op: "remove", slot: "sections.faq" } }] }, undefined, options);
    expect(next.surfaces!.fills.some(doc => doc.$extensions["com.clossys.fill"].slot === "sections.faq")).toBe(false);
    const frame = surfaceEntryOf(next.surfaces!.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "frames.app-shell")!) as SurfacePackageEntry & { origin: SurfacePackageOrigin };
    expect(frame.origin.descriptorHash).toBe(from);
    expect((await cli("check", "--layer", "frames", "--json")).code).toBe(0);
    expect((await cli("receipt", "--json")).code).toBe(0);
  });

  it("surfaces rejects every unrelated flag before reading or writing a library", async () => {
    await staleFrame();
    const before = await bytes();
    const refused = [
      ["--check"], ["--write"], ["--write-needs"], ["--changeset", "unused.json"],
      ["--source", "foundry"], ["--layer", "frames"], ["--target", "surface-index"],
      ["--status", "open"], ["--candidate", "{}"], ["--closed-by", "unused"],
      ["--contract", "unused.json"], ["--base", "unused.json"], ["--leaf", "frames.app-shell"],
      ["--starter", "custom"], ["--driver", "unused"], ["--out", "unused"], ["--unknown"],
    ];
    for (const flags of refused) {
      const result = await cli("surfaces", "--refresh", "frames.app-shell", ...flags);
      expect(result.code, flags.join(" ")).toBe(2);
      expect(result.out, flags.join(" ")).toBe("");
      expect(await bytes(), flags.join(" ")).toEqual(before);
      // A missing root must produce the same usage error, proving parsing refuses before disk access.
      const errors: string[] = [];
      const missing = await main(["surfaces", "--refresh", "frames.app-shell", ...flags, "--root", join(temporary, "missing")], { out: () => {}, error: text => errors.push(text) });
      expect(missing).toBe(2);
      expect(errors.join("\n")).toBe(result.error);
    }
  });
  it("the compiled public bin refreshes canonical bytes with same-source history and a valid receipt", async () => {
    const { from } = await staleFrame();
    const held = await readLibrary(root, catalog);
    const oldEntry = surfaceEntryOf(held.surfaces!.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "frames.app-shell")!) as SurfacePackageEntry & { origin: SurfacePackageOrigin };
    const before = await bytes();
    const refused = await publicBin("surfaces", "--refresh", "frames.app-shell", "--check");
    expect(refused.code).toBe(2);
    expect(refused.out).toBe("");
    expect(await bytes()).toEqual(before);
    expect((await publicBin("check", "--layer", "frames", "--json")).code).toBe(0);
    const result = await publicBin("surfaces", "--refresh", "frames.app-shell", "--json");
    expect(result.error).toBe(""); expect(result.code).toBe(0);
    const next = await readLibrary(root, catalog);
    const entry = surfaceEntryOf(next.surfaces!.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "frames.app-shell")!) as SurfacePackageEntry & { origin: SurfacePackageOrigin };
    expect(JSON.parse(result.out)).toEqual({ ok: true, baseHash: compositeLibraryHash(next), contractDiff: surfaceContractDiff(oldEntry, entry, { before: resolveSurfacePackageDescriptor(catalog, oldEntry.slot, oldEntry.origin).contract, after: resolveSurfacePackageDescriptor(catalog, entry.slot, entry.origin).contract }) });
    expect(entry.origin.source).toBe(oldEntry.origin.source);
    expect(entry.origin.history).toEqual([{ from, to: entry.origin.descriptorHash }]);
    expect(entry.origin.descriptorHash).not.toBe(from);
    expect((await publicBin("check", "--layer", "frames", "--json")).code).toBe(0);
    expect((await publicBin("emit", "--check")).code).toBe(0);
    expect((await publicBin("receipt", "--json")).code).toBe(0);
    const canonical = await bytes();
    expect((await publicBin("surfaces", "--refresh", "frames.app-shell", "--json")).code).toBe(0);
    expect(await bytes()).toEqual(canonical);
  });

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
