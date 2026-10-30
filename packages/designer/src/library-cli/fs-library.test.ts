// @vitest-environment node
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLibraryChange, check, generateSelection, libraryHash, loadCatalog, stableStringify, type ChangeSet, type LibraryData, type CompositeCatalogData, type CompositeLibraryData } from "../catalog-core/index.js";
import { adoptedComponentIntegration, componentIntegration } from "../catalog-core/__fixtures__/component-integration.js";
import { sha256 } from "../catalog-core/digest.js";
import { isObservationPending } from "../catalog-core/check-components.js";
import { syntheticSource } from "../catalog-core/__fixtures__/component-engine/synthetic.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import { checkLibrary, emitLibrary, isLibraryChangeSet, libraryFiles, LibraryCheckError, LibraryConflictError, readLibrary, writeLibrary, writeCompositeLibrary } from "./fs-library.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile), rename: vi.fn(actual.rename) };
});
const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const catalog = loadCatalog();
let fixture: LibraryData, temporary: string, root: string;
beforeAll(() => {
  fixture = completedCatalogLibrary(catalog, { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-23");
  expect(check({ catalog, library: fixture }).ok).toBe(true);
});
beforeEach(async () => {
  vi.mocked(fs.writeFile).mockImplementation(actualFs.writeFile);
  vi.mocked(fs.rename).mockImplementation(actualFs.rename);
  temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "designer-library-")));
  root = join(temporary, "library");
  await fs.mkdir(join(root, "fills"), { recursive: true });
  for (const [name, content] of libraryFiles(catalog, fixture)) {
    await fs.mkdir(dirname(join(root, name)), { recursive: true });
    await fs.writeFile(join(root, name), content);
  }
});
afterEach(async () => {
  vi.mocked(fs.writeFile).mockImplementation(actualFs.writeFile);
  vi.mocked(fs.rename).mockImplementation(actualFs.rename);
  await fs.rm(temporary, { recursive: true, force: true });
});
const noChange = (library: LibraryData): ChangeSet => ({ baseHash: libraryHash(library), changes: [] });
const change = (library: LibraryData): ChangeSet => ({ baseHash: libraryHash(library), changes: [{ op: "author", slot: "tokens.blur", tokens: { glass: { $type: "dimension", $value: { value: 18, unit: "px" } } } }] });

describe("consumer library disk format", () => {
  it("round trips consumer values, provenance, selection and helpers without catalog autofill", async () => {
    await fs.writeFile(join(root, "helper.ts"), "export const helper = true;\n");
    const library = await readLibrary(root, catalog);
    expect(libraryHash(library)).toBe(libraryHash(fixture));
    expect(library.selection).toEqual(generateSelection(library));
    expect((await checkLibrary(root, catalog)).ok).toBe(true);
    await writeLibrary(root, catalog, noChange(library));
    expect(await fs.readFile(join(root, "helper.ts"), "utf8")).toContain("helper");
    expect(await fs.readdir(temporary)).toEqual(["library"]);
    const empty: LibraryData = { source: fixture.source, fills: [] };
    expect(JSON.parse(libraryFiles(catalog, empty).get("resolved.json")!).members).toEqual({});
    expect(libraryFiles(catalog, empty).has("provenance.json")).toBe(false);
  });

  it("rejects symlinked files, fills, helper directories, roots and ancestors", async () => {
    const outside = join(temporary, "outside"); await fs.mkdir(outside);
    await fs.writeFile(join(outside, "secret.json"), "{}");
    await fs.symlink(join(outside, "secret.json"), join(root, "linked.json"));
    await expect(readLibrary(root, catalog)).rejects.toThrow(/symlink/);
    await expect(writeLibrary(root, catalog, noChange(fixture))).rejects.toThrow(/symlink/);
    await fs.unlink(join(root, "linked.json"));
    await fs.symlink(outside, join(root, "linked"));
    await expect(readLibrary(root, catalog)).rejects.toThrow(/symlink/);
    await fs.unlink(join(root, "linked"));
    await fs.symlink(root, join(temporary, "root-link"));
    await expect(readLibrary(join(temporary, "root-link"), catalog)).rejects.toThrow(/directory/);
    await fs.symlink(temporary, join(temporary, "ancestor-link"));
    await expect(readLibrary(join(temporary, "ancestor-link", "library"), catalog)).rejects.toThrow(/directory/);
    const fillName = (await fs.readdir(join(root, "fills")))[0]!;
    await fs.unlink(join(root, "fills", fillName));
    await fs.symlink(join(outside, "secret.json"), join(root, "fills", fillName));
    await expect(readLibrary(root, catalog)).rejects.toThrow(/symlink/);
    expect(await fs.readFile(join(outside, "secret.json"), "utf8")).toBe("{}");
  });

  it("rejects traversal, absolute paths, unknown operations and prototype members before writes", async () => {
    for (const slot of ["../outside", "/outside", "tokens.blur/../../outside", "tokens.blur\\outside"]) {
      const cs = { baseHash: libraryHash(fixture), changes: [{ op: "remove", slot }] };
      expect(isLibraryChangeSet(cs, catalog)).toBe(false);
      await expect(writeLibrary(root, catalog, cs as ChangeSet)).rejects.toThrow(/Invalid/);
    }
    for (const member of ["../outside", "/outside", "sm.constructor.value", "__proto__.polluted", "sm\\outside"]) {
      expect(isLibraryChangeSet({ baseHash: libraryHash(fixture), changes: [{ op: "author", slot: "tokens.blur", tokens: { [member]: { $type: "dimension", $value: "5px" } } }] }, catalog)).toBe(false);
    }
    expect(isLibraryChangeSet({ baseHash: libraryHash(fixture), changes: [{ op: "autofill", slot: "tokens.blur" }] }, catalog)).toBe(false);
    expect(await fs.readdir(temporary)).toEqual(["library"]);
  });

  it("contains every emitted path, even if an emitter returns a traversal path", async () => {
    const mapSet = Map.prototype.set;
    const spy = vi.spyOn(Map.prototype, "set").mockImplementation(function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
      // Mutate the returned output map without changing the engine's emit-file type.
      return mapSet.call(this, key === "brand.css" ? "../outside.css" : key, value);
    });
    try { await expect(writeLibrary(root, catalog, noChange(fixture)).then(() => undefined)).rejects.toThrow(/outside root/); }
    finally { spy.mockRestore(); }
    expect(await fs.readdir(temporary)).toEqual(["library"]);
  });

  it("rejects stale selection and noncatalog fill filenames", async () => {
    await fs.writeFile(join(root, "selection.json"), "{}");
    await expect(readLibrary(root, catalog)).rejects.toThrow(/selection drift/);
    await fs.writeFile(join(root, "selection.json"), stableStringify(generateSelection(fixture)));
    await fs.writeFile(join(root, "fills", "unknown.json"), "{}");
    await expect(readLibrary(root, catalog)).rejects.toThrow(/filename/);
  });
});

describe("atomic writes and concurrency", () => {
  it("checks a proposed library before committing it", async () => {
    await expect(writeLibrary(root, catalog, { baseHash: libraryHash(fixture), changes: [{ op: "remove", slot: "tokens.blur" }] })).rejects.toBeInstanceOf(LibraryCheckError);
    expect(libraryHash(await readLibrary(root, catalog))).toBe(libraryHash(fixture));
  });

  it("applies consumer-authored values and CAS allows only one concurrent winner", async () => {
    const cs = change(fixture), writes = await Promise.allSettled([writeLibrary(root, catalog, cs), writeLibrary(root, catalog, cs)]);
    expect(writes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(writes.find(result => result.status === "rejected")).toMatchObject({ reason: expect.any(LibraryConflictError) });
    const expected = applyLibraryChange(catalog, fixture, cs);
    expect(libraryHash(await readLibrary(root, catalog))).toBe(libraryHash(expected));
    expect(await fs.readdir(temporary)).toEqual(["library"]);
  });

  it("keeps partially staged writes invisible and cleans them after failure", async () => {
    const before = await fs.readFile(join(root, "metadata.json"), "utf8");
    let stagedWrites = 0;
    vi.mocked(fs.writeFile).mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
      if (String(args[0]).includes(".library-staging")) {
        expect(await fs.readFile(join(root, "metadata.json"), "utf8")).toBe(before);
        expect((await rawLibrary()).selection).toEqual(generateSelection(fixture));
        if (++stagedWrites === 4) throw new Error("Injected stage failure");
      }
      return actualFs.writeFile(...args);
    });
    await expect(writeLibrary(root, catalog, change(fixture)).then(() => undefined)).rejects.toThrow("Injected stage failure");
    expect(stagedWrites).toBe(4);
    expect(libraryHash(await readLibrary(root, catalog))).toBe(libraryHash(fixture));
    expect(await fs.readdir(temporary)).toEqual(["library"]);
  });

  it("rolls back if the second directory rename fails", async () => {
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (String(from) === join(temporary, ".library-staging") && String(to) === root) throw new Error("Injected swap failure");
      return actualFs.rename(from, to);
    });
    await expect(writeLibrary(root, catalog, change(fixture))).rejects.toThrow("Injected swap failure");
    expect(libraryHash(await readLibrary(root, catalog))).toBe(libraryHash(fixture));
    expect(await fs.readdir(temporary)).toEqual(["library"]);
  });

  it("refuses existing cross-process locks and transaction residue without deleting evidence", async () => {
    const lock = join(temporary, ".library-lock"); await fs.mkdir(lock);
    await expect(writeLibrary(root, catalog, noChange(fixture))).rejects.toMatchObject({ code: "EEXIST" });
    await expect(readLibrary(root, catalog)).rejects.toMatchObject({ code: "EEXIST" });
    await fs.rmdir(lock);
    for (const name of [".library-staging", ".library-backup"]) {
      await fs.mkdir(join(temporary, name));
      await expect(readLibrary(root, catalog)).rejects.toThrow(/Unfinished/);
      expect((await fs.stat(join(temporary, name))).isDirectory()).toBe(true);
      await fs.rmdir(join(temporary, name));
    }
  });

  it("serializes a read during a generation swap", async () => {
    let release!: () => void, entered!: () => void;
    const enteredSwap = new Promise<void>(done => { entered = done; }), pause = new Promise<void>(done => { release = done; });
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (String(from) === root) { entered(); await pause; }
      return actualFs.rename(from, to);
    });
    const writing = writeLibrary(root, catalog, change(fixture));
    await Promise.race([enteredSwap, writing.then(() => { throw new Error("Writer did not reach swap"); })]);
    const reading = readLibrary(root, catalog);
    release();
    expect(libraryHash(await reading)).toBe(libraryHash(await writing));
  });
});

describe("emission", () => {
  it("finds byte drift without writes, then repairs it atomically", async () => {
    expect(await emitLibrary(root, catalog, { check: true })).toEqual({ ok: true, drift: [] });
    await fs.writeFile(join(root, "brand.css"), "drift\n");
    const checked = await emitLibrary(root, catalog, { check: true });
    expect(checked).toEqual({ ok: false, drift: ["brand.css"] });
    expect(await fs.readFile(join(root, "brand.css"), "utf8")).toBe("drift\n");
    await emitLibrary(root, catalog);
    expect(await emitLibrary(root, catalog, { check: true })).toEqual({ ok: true, drift: [] });
  });
});

/** Direct observations during staging deliberately bypass the cooperative lock. */
async function rawLibrary(): Promise<LibraryData> {
  const parse = async (name: string) => JSON.parse(await fs.readFile(join(root, name), "utf8"));
  return { ...await parse("metadata.json"), source: await parse("source.json"), selection: await parse("selection.json"), fills: await Promise.all((await fs.readdir(join(root, "fills"))).sort().map(name => parse(`fills/${name}`))) };
}


describe("composite consumer library disk format", () => {
  function compositeFixture(): { catalog: CompositeCatalogData; library: CompositeLibraryData } {
    const input = componentIntegration(true), source = syntheticSource();
    const adapter = { path: "adapters/button.ts", content: "export const adapter = true;\n" };
    source.candidate.outputSha256 = [...source.candidate.outputSha256!, { path: adapter.path, sha256: sha256(adapter.content) }];
    const library: CompositeLibraryData = {
      ...input.library,
      values: { ...input.library.values, fills: [...input.library.values.fills].sort((a, b) => a.$extensions["com.clossys.fill"].slot.localeCompare(b.$extensions["com.clossys.fill"].slot)), selection: generateSelection({ ...input.library.values, source: input.library.source, adoptedAt: input.library.adoptedAt }) },
      components: { fills: [{ ...source.doc, $extensions: { "com.clossys.fill": { ...source.doc.$extensions["com.clossys.fill"], source: input.library.source.id } }, components: { button: { ...source.candidate, source: input.library.source.id, origin: { kind: "authored", license: "MIT" } } } }], files: [
        source.file, adapter, source.notice,
      ] },
    };
    return { catalog: input.catalog, library };
  }
  async function save(files: Map<string, string>) {
    await fs.rm(root, { recursive: true }); await fs.mkdir(join(root, "fills"), { recursive: true });
    for (const [name, content] of files) { await fs.mkdir(dirname(join(root, name)), { recursive: true }); await fs.writeFile(join(root, name), content); }
  }
  it("round trips components slot filenames and exact source adapter notice bytes", async () => {
    const input = compositeFixture();
    const files = libraryFiles(input.catalog, input.library, []);
    expect(files.has("fills/components.button.json")).toBe(true);
    await save(files);
    // Generated output is not part of the explicit owned source inventory.
    await fs.writeFile(join(root, "components/button/index.ts"), "generated output\n");
    expect(await readLibrary(root, input.catalog)).toEqual(input.library);
    for (const file of input.library.components.files) expect(await fs.readFile(join(root, file.path), "utf8")).toBe(file.content);
  });
  it("removes component and generated paths with an opted-in whole projection without old observations",async()=>{
    const input=compositeFixture();input.library.surfaces={version:1,fills:[],files:[]};await save(libraryFiles(input.catalog,input.library,[]));
    await fs.mkdir(join(root,"components/button"),{recursive:true});await fs.writeFile(join(root,"components/button/index.ts"),"old generated leaf\n");await fs.writeFile(join(root,"host.txt"),"host");
    const removed=await writeCompositeLibrary(root,input.catalog,{baseHash:libraryHash(input.library),changes:[{portion:"components",change:{op:"remove",slot:"components.button"}}]});
    expect(libraryHash(await readLibrary(root,input.catalog))).toBe(libraryHash(removed));expect(removed.components.files).toEqual([]);
    for(const file of input.library.components.files)await expect(fs.stat(join(root,file.path))).rejects.toMatchObject({code:"ENOENT"});await expect(fs.stat(join(root,"components/button/index.ts"))).rejects.toMatchObject({code:"ENOENT"});expect(await fs.readFile(join(root,"host.txt"),"utf8")).toBe("host");
  });
  it("checks composite components through the existing engine without inventing runtime evidence", async () => {
    const input = compositeFixture(); await save(libraryFiles(input.catalog, input.library, []));
    const checked = await checkLibrary(root, input.catalog);
    // Without supplied observations the fill is runtime-pending (notices, never a pass), and without declared
    // package exports emission still refuses: nothing is inferred from absent evidence.
    const button = checked.findings.filter(finding => finding.subject === "components.button");
    expect(checked.ok).toBe(true);
    expect(button.map(finding => finding.code).sort()).toEqual(["K10", "K12", "K2", "K4", "K5", "K6", "K7"]);
    expect(button.every(isObservationPending)).toBe(true);
    await expect(emitLibrary(root, input.catalog)).rejects.toThrow(/unavailable named import Button/);
  });
  function needRecord(id = "NEED-001") {
    return { id, raisedBy: "components.button", missing: "disabled state", kind: "leaf", status: "open", candidate: null, evidence: [{ file: "src/Page.tsx", line: 1, code: "DF5" }], createdBy: "owner", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", closedBy: null };
  }
  it("reads composite libraries without creating NEED storage or changing valid NEED bytes", async () => {
    const input = compositeFixture(); await save(libraryFiles(input.catalog, input.library, []));
    expect(await readLibrary(root, input.catalog)).toEqual(input.library);
    await expect(fs.stat(join(root, "needs"))).rejects.toMatchObject({ code: "ENOENT" });
    await fs.mkdir(join(root, "needs"));
    const bytes = JSON.stringify(needRecord(), null, 3) + "\n";
    await fs.writeFile(join(root, "needs/NEED-001.json"), bytes);
    expect(await readLibrary(root, input.catalog)).toEqual(input.library);
    expect(await fs.readFile(join(root, "needs/NEED-001.json"), "utf8")).toBe(bytes);
    expect(await fs.readdir(join(root, "needs"))).toEqual(["NEED-001.json"]);
  });
  it.each([
    ["bad.json", "{}", "Invalid NEED filename"],
    ["NEED-001.json", "{", "Invalid NEED file"],
    ["NEED-001.json", JSON.stringify({ ...needRecord(), status: "invented" }), "Invalid NEED record"],
  ])("refuses malformed NEED evidence %s before serving a composite library", async (name, bytes, message) => {
    const input = compositeFixture(); await save(libraryFiles(input.catalog, input.library, []));
    await fs.mkdir(join(root, "needs")); await fs.writeFile(join(root, "needs", name), bytes);
    await expect(readLibrary(root, input.catalog)).rejects.toThrow(message);
    expect(await fs.readFile(join(root, "needs", name), "utf8")).toBe(bytes);
  });
  it("refuses duplicate NEED capabilities without altering their records", async () => {
    const input = compositeFixture(); await save(libraryFiles(input.catalog, input.library, []));
    await fs.mkdir(join(root, "needs"));
    for (const id of ["NEED-001", "NEED-002"]) await fs.writeFile(join(root, `needs/${id}.json`), JSON.stringify(needRecord(id)));
    await expect(readLibrary(root, input.catalog)).rejects.toThrow("Duplicate NEED capability");
    expect((await fs.readdir(join(root, "needs"))).sort()).toEqual(["NEED-001.json", "NEED-002.json"]);
  });
  it("refuses symlinked NEED storage without following or replacing it", async () => {
    const input = compositeFixture(); await save(libraryFiles(input.catalog, input.library, []));
    const outside = join(temporary, "outside-needs"); await fs.mkdir(outside);
    const bytes = JSON.stringify(needRecord()); await fs.writeFile(join(outside, "NEED-001.json"), bytes);
    await fs.symlink(outside, join(root, "needs"));
    await expect(readLibrary(root, input.catalog)).rejects.toThrow(/symlink|regular directory/);
    expect((await fs.lstat(join(root, "needs"))).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(join(outside, "NEED-001.json"), "utf8")).toBe(bytes);
  });
  it("emits adopted components with caller supplied independent engine observations", async () => {
    const input = adoptedComponentIntegration();
    await save(libraryFiles(input.catalog, input.library, undefined, input.componentOptions));
    expect((await checkLibrary(root, input.catalog, input.componentOptions)).ok).toBe(true);
    expect((await emitLibrary(root, input.catalog, { check: true, componentOptions: input.componentOptions })).ok).toBe(true);
    expect(await fs.readFile(join(root, "components/button/index.ts"), "utf8")).toContain("Button");
    const read = await readLibrary(root, input.catalog);
    expect(read.components.files).toEqual([]);
  });
  it("emits and drift checks an empty composite component portion deterministically", async () => {
    const input = compositeFixture(); input.library.components = { fills: [], files: [] };
    input.catalog.components = { slots: [], fills: [] };
    await save(libraryFiles(input.catalog, input.library));
    expect((await emitLibrary(root, input.catalog, { check: true })).ok).toBe(true);
    expect(await fs.readFile(join(root, "component-index.ts"), "utf8")).toContain("LibraryProvider");
    await fs.writeFile(join(root, "component-index.ts"), "drift\n");
    expect(await emitLibrary(root, input.catalog, { check: true })).toMatchObject({ ok: false, drift: ["component-index.ts"] });
    await emitLibrary(root, input.catalog);
    expect((await emitLibrary(root, input.catalog, { check: true })).ok).toBe(true);
  });
});
