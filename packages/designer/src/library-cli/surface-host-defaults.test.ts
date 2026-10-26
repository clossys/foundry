// @vitest-environment node
/**
 * Hosts that only know the value and component catalogs still read, check, save and emit a library
 * whose Sections and Frames were adopted as package pointers: the disk boundary supplies Foundry's own
 * surface contracts and reads package export evidence from the installed barrels when the host does not.
 */
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { compositeLibraryHash } from "../catalog-core/library-components.js";
import type { CompositeCatalogData, CompositeLibraryData } from "../catalog-core/types.js";
import { packageSurfaceLibrary } from "./__fixtures__/package-surface-library.js";
import { checkLibrary, emitLibrary, isCompositeChangeSet, libraryFiles, readLibrary, writeCompositeLibrary } from "./fs-library.js";

let catalog: CompositeCatalogData, host: CompositeCatalogData, library: CompositeLibraryData, files: ReadonlyMap<string, string>;
let temporary: string, root: string;

beforeAll(async () => {
  const fixture = await packageSurfaceLibrary();
  ({ catalog, library } = fixture);
  // What a host that never wired Sections or Frames passes: value and component catalogs only.
  host = { values: catalog.values, components: catalog.components };
  files = libraryFiles(catalog, library, undefined, undefined, fixture.options);
}, 120_000);
beforeEach(async () => {
  temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "surface-host-defaults-")));
  root = join(temporary, "library");
  await fs.mkdir(join(root, "fills"), { recursive: true });
  for (const [name, content] of files) { await fs.mkdir(dirname(join(root, name)), { recursive: true }); await fs.writeFile(join(root, name), content); }
});
afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }); });

const surfaceErrors = (findings: readonly { rule: string; severity: string; code: string; subject: string }[]) =>
  findings.filter(row => row.rule === "surfaces" && row.severity === "error").map(row => `${row.code} ${row.subject}`);
const pointers = (value: CompositeLibraryData) => (value.surfaces?.fills ?? []).filter(doc => Object.values({ ...doc.sections, ...doc.frames }).some(leaf => (leaf as { impl?: { kind?: string } }).impl?.kind === "package")).length;

describe("package-pointer surfaces without host surface wiring", { timeout: 120_000 }, () => {
  it("reads the library back through a host catalog that omits surfaces", async () => {
    expect(pointers(library)).toBeGreaterThan(40);
    const read = await readLibrary(root, host);
    expect(pointers(read)).toBe(pointers(library));
    expect(compositeLibraryHash(read)).toBe(compositeLibraryHash(library));
  });

  it("keeps a host-supplied surface catalog authoritative", async () => {
    await expect(readLibrary(root, { ...host, surfaces: { slots: [], fills: [], transforms: [], rules: [], materializations: [] } })).rejects.toThrow(/Orphan or unknown surface fill/);
  });

  it("checks clean with no host evidence by reading the installed package barrels", async () => {
    for (const given of [catalog, host]) {
      const result = await checkLibrary(root, given);
      expect(surfaceErrors(result.findings)).toEqual([]);
      expect(result.findings.some(row => row.rule === "surfaces" && row.severity === "notice" && /package pointer/.test(row.message))).toBe(true);
    }
    // Evidence the host does pass is used as given: an empty inventory still fails S4.
    expect(surfaceErrors((await checkLibrary(root, host, undefined, { packages: [], measurements: [] })).findings).some(row => row.startsWith("S4 "))).toBe(true);
  });

  it("saves a values change through a host catalog without surfaces or options and keeps every pointer", async () => {
    // Re-adopting an adopted icon from its own source: a values-only save, as an editor host sends.
    const lucide = library.values.fills.find(fill => fill.$extensions["com.clossys.fill"].slot.startsWith("assets.icon-") && JSON.stringify(fill).includes('"source":"lucide"'))!;
    const change = { baseHash: compositeLibraryHash(await readLibrary(root, host)), changes: [{ portion: "values" as const, change: { op: "adopt" as const, slot: lucide.$extensions["com.clossys.fill"].slot, source: "lucide" } }] };
    expect(isCompositeChangeSet(change, host)).toBe(true);
    const saved = await writeCompositeLibrary(root, host, change);
    expect(pointers(saved)).toBe(pointers(library));
    expect(pointers(await readLibrary(root, host))).toBe(pointers(library));
  });

  it("accepts a surfaces changeset and emits with --check through a host catalog without surfaces", async () => {
    const slot = library.surfaces!.fills[0]!.$extensions["com.clossys.fill"].slot;
    expect(isCompositeChangeSet({ baseHash: compositeLibraryHash(library), changes: [{ portion: "surfaces", change: { op: "remove", slot } }] }, host)).toBe(true);
    expect(await emitLibrary(root, host, { check: true })).toEqual({ ok: true, drift: [] });
  });
});
