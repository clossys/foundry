// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readSelectedSurfaceRuntimeArtifacts } from "./selected-surface-artifacts.js";
import { applyLibraryChange, libraryHash, resolve } from "../catalog-core/api.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { readSurfacePackageEvidence } from "./surface-package-evidence.js";
import { loadCatalog, loadSectionRegistry } from "../catalog-core/index.js";
import { isSurfacePackageEntry, surfaceDescriptorHash, surfaceDocument, surfaceEntryOf, surfaceManifest } from "../catalog-core/surface-library.js";
import { surfaceRuntimeIdentity } from "../catalog-core/surface-check.js";
import { runtimeHash, runtimeSnapshot } from "../catalog-core/runtime-ports.js";
import { adoptedSurface, syntheticDerivation } from "../catalog-core/__fixtures__/surface-engine/synthetic.js";
import { sha256 } from "../catalog-core/digest.js";
import type { CompositeEngineInput } from "../catalog-core/types.js";
import type { SurfaceCandidate, SurfaceCandidateDocument, SurfaceMeasurement, SurfaceSlot } from "../catalog-core/surface-types.js";

// SYNTHETIC unit-test records and modeled receipts exercise real/synthetic input branches.
// No compiler, module loader, production observation or runtime qualification runs here.
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "surface-artifact-reader-")); roots.push(root);
  const leaf = "sections.reader" as const;
  const source = { path: "sections/reader/Reader.ts", content: 'export function Reader() { return "reader"; }\n' };
  const noticeText = "Reader unit-test source, MIT\n";
  const notice = { path: `notices/surfaces/n-${sha256(noticeText)}.txt`, content: noticeText };
  const files = [source, notice];
  const fill: SurfaceCandidate = { kind: "section", slot: leaf, source: "example", impl: { kind: "source", entry: source.path, export: "Reader" }, rendering: "server", members: [], states: ["default"], reads: { tokens: [], assets: [] }, composes: [], parts: [], api: { version: 1, exports: [{ name: "Reader", export: "Reader" }] }, bindings: [], dependencies: [], license: "MIT", pin: { kind: "local-tree", tree: "a".repeat(40), files: surfaceManifest(files) }, notice: notice.path, outputSha256: surfaceManifest(files), blockers: [], propMap: {}, slotMap: {}, configs: {} };
  const engine: CompositeEngineInput = {
    catalog: {
      values: loadCatalog(),
      components: { slots: [], fills: [] },
      surfaces: { slots: [{ id: leaf, layer: "sections", status: "draft", requires: [], contract: { kind: "section", root: "section", anatomy: { band: null, header: null }, slots: [], members: { mode: "closed", names: [] }, allowedComposes: [], parts: [], allowedReads: { tokens: [], assets: [] }, data: "host-injected", surface: "both" } }], fills: [], transforms: [], rules: [], materializations: [] },
    },
    library: { source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, values: { fills: [] }, components: { fills: [], files: [] } },
    surfaceOptions: { packages: [], measurements: [] },
  };
  const lineage = { source: "example", fill: "example/sections.reader", license: "MIT", pin: fill.pin, descriptorHash: surfaceDescriptorHash(fill), upstreamSha256: surfaceManifest(files), notices: [{ path: notice.path, sha256: sha256(notice.content) }] };
  engine.library.surfaces = { version: 1, fills: [surfaceDocument(engine.library, { ...fill, origin: { kind: "authored", license: "MIT", descriptorHash: surfaceDescriptorHash(fill), lineage } })], files };
  const compilerSource = { entry: "unit-test-compiler.txt", files: { "unit-test-compiler.txt": "Modeled command identity for reader validation only" }, dependencies: {} };
  const command = { argv: ["unit-test-compiler"], exitCode: 0, stdoutSha256: sha256(""), stderrSha256: sha256("") };
  const measurement: SurfaceMeasurement = { version: 1, slot: leaf, scope: "real", identity: surfaceRuntimeIdentity(resolve(engine).surfaces!.fills[leaf]), source: { entry: source.path, files: { [source.path]: source.content }, dependencies: {} }, compiled: { entry: "sections/reader/Reader.js", files: { "sections/reader/Reader.js": 'export function Reader() { return "reader"; }\n', "chunks/shared.js": 'export const label = "reader";\n' }, dependencies: {} }, compiler: { id: "reader-unit-test-model", source: compilerSource, sourceHash: runtimeHash(compilerSource) }, command, checks: { types: "pass", closure: "pass" }, runtime: null };
  engine.surfaceOptions = { packages: [], measurements: [measurement] };
  expect(resolve(engine).check.findings.filter(row => row.severity === "error")).toEqual([]);
  for (const [path, text] of Object.entries(measurement.compiled.files)) { await fs.mkdir(dirname(join(root, path)), { recursive: true }); await fs.writeFile(join(root, path), text); }
  return { root, leaf, engine, measurement, selected: [leaf], artifacts: [{ leaf, compiledRoot: root }] };
}

async function available(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await readSelectedSurfaceRuntimeArtifacts(f);
  expect(result.status, JSON.stringify(result)).toBe("artifacts");
  if (result.status !== "artifacts") throw new Error(JSON.stringify(result));
  return result;
}
async function refused(f: Awaited<ReturnType<typeof fixture>>, finding: string) {
  const result = await readSelectedSurfaceRuntimeArtifacts(f);
  expect(result).toMatchObject({ status: "refused", findings: expect.arrayContaining([expect.stringContaining(finding)]) });
}

describe("selected surface artifact reader", () => {
  it("reads current exact selected compiled bytes without ports, execution or current evidence", async () => {
    const f = await fixture(), original = runtimeHash(f.engine.library);
    const result = await readSelectedSurfaceRuntimeArtifacts(f);
    expect(result.status).toBe("artifacts");
    if (result.status !== "artifacts") throw new Error(JSON.stringify(result));
    expect(Object.keys(result).sort()).toEqual(["engine", "status", "surfaces"]);
    expect(result.surfaces).toEqual([{ leaf: f.leaf, measurement: f.measurement, compiledFiles: f.measurement.compiled.files }]);
    expect(result.surfaces[0]!.measurement).not.toBe(f.measurement);
    expect(Object.isFrozen(result.surfaces[0]!.compiledFiles)).toBe(true);
    expect(runtimeHash(f.engine.library)).toBe(original);
    for (const name of ["runtime", "ports", "renderers", "current", "ready", "sourceHashes"]) expect(result).not.toHaveProperty(name);
  });

  it("changed byte refuses even with rehashed caller descriptor [mutant: changed-byte]", async () => {
    const f = await fixture(); await available(f);
    const changed = 'export function Reader() { throw new Error("changed"); }\n';
    await fs.writeFile(join(f.root, f.measurement.compiled.entry), changed);
    const callerDescriptor = { id: "forged", source: { ...f.measurement.compiled, files: { ...f.measurement.compiled.files, [f.measurement.compiled.entry]: changed } } };
    expect(runtimeHash(callerDescriptor.source)).not.toBe(runtimeHash(f.measurement.compiled));
    const result = await readSelectedSurfaceRuntimeArtifacts({ ...f, callerDescriptor: { ...callerDescriptor, sourceHash: runtimeHash(callerDescriptor.source) } } as typeof f);
    expect(result).toMatchObject({ status: "refused", findings: expect.arrayContaining([`sections.reader: COMPILED_BYTES_DIFFER: ${f.measurement.compiled.entry}`]) });
  });

  it("compares UTF-8 bytes exactly rather than replacement-decoded strings", async () => {
    const f = await fixture(); await available(f);
    f.measurement.compiled = { ...f.measurement.compiled, files: { ...f.measurement.compiled.files, [f.measurement.compiled.entry]: "�" } };
    await fs.writeFile(join(f.root, f.measurement.compiled.entry), Buffer.from([0xff]));
    await refused(f, "COMPILED_BYTES_DIFFER");
  });

  it("matches unique current measurement instead of first slot measurement [mutant: first-measurement]", async () => {
    const f = await fixture(), stale = structuredClone(f.measurement); stale.identity.apiHash = `sha256:${"b".repeat(64)}`;
    f.engine.surfaceOptions = { packages: [], measurements: [stale, f.measurement] };
    expect(await readSelectedSurfaceRuntimeArtifacts(f)).toMatchObject({ status: "artifacts", surfaces: [{ measurement: f.measurement }] });
    f.engine.surfaceOptions = { packages: [], measurements: [stale] };
    expect(await readSelectedSurfaceRuntimeArtifacts(f)).toMatchObject({ status: "refused" });
    f.engine.surfaceOptions = { packages: [], measurements: [f.measurement, structuredClone(f.measurement)] };
    expect(await readSelectedSurfaceRuntimeArtifacts(f)).toMatchObject({ status: "refused" });
  });

  it("stale current source identity refuses through existing S8 checks", async () => {
    const f = await fixture(); f.measurement.source = { ...f.measurement.source, files: { [f.measurement.source.entry]: 'export function Reader() { return "stale"; }' } };
    expect(await readSelectedSurfaceRuntimeArtifacts(f)).toMatchObject({ status: "refused", findings: expect.arrayContaining([expect.stringContaining("selected component closure differ")]) });
  });

  it("foreign selected or artifact leaf refuses [mutant: foreign-leaf]", async () => {
    const f = await fixture(), foreign: SurfaceSlot = "sections.foreign";
    expect(await readSelectedSurfaceRuntimeArtifacts({ ...f, selected: [foreign], artifacts: [{ leaf: foreign, compiledRoot: f.root }] })).toMatchObject({ status: "refused" });
    expect(await readSelectedSurfaceRuntimeArtifacts({ ...f, artifacts: [...f.artifacts, { leaf: foreign, compiledRoot: f.root }] })).toMatchObject({ status: "refused" });
    expect(await readSelectedSurfaceRuntimeArtifacts({ ...f, selected: [f.leaf, f.leaf] })).toMatchObject({ status: "refused" });
    expect(await readSelectedSurfaceRuntimeArtifacts({ ...f, artifacts: [...f.artifacts, f.artifacts[0]!] })).toMatchObject({ status: "refused" });
  });

  it("accepts canonical roots and ancestral directory aliases", async () => {
    const f = await fixture(), first = await available(f), canonicalRoot = await fs.realpath(f.root);
    f.artifacts = [{ leaf: f.leaf, compiledRoot: canonicalRoot }];
    expect((await available(f)).surfaces).toEqual(first.surfaces);
    const parent = await fs.mkdtemp(join(tmpdir(), "surface-reader-alias-")); roots.push(parent);
    const alias = join(parent, "ancestor"); await fs.symlink(dirname(canonicalRoot), alias);
    f.artifacts = [{ leaf: f.leaf, compiledRoot: join(alias, canonicalRoot.slice(dirname(canonicalRoot).length + 1)) }];
    expect((await available(f)).surfaces).toEqual(first.surfaces);
  });

  it("refuses a supplied root link independently of child checks [mutant: containment]", async () => {
    const f = await fixture(); await available(f);
    const parent = await fs.mkdtemp(join(tmpdir(), "surface-reader-root-link-")); roots.push(parent);
    const rootLink = join(parent, "root"); await fs.symlink(f.root, rootLink);
    f.artifacts = [{ leaf: f.leaf, compiledRoot: rootLink }];
    await refused(f, "COMPILED_PATH_NOT_REGULAR_DIRECTORY");
  });

  it.each(["inside", "outside"])("refuses child directory links %s the root [mutant: containment]", async location => {
    const f = await fixture(); await available(f);
    const other = location === "inside" ? f.root : await fs.mkdtemp(join(tmpdir(), "surface-reader-dir-link-"));
    if (location === "outside") roots.push(other);
    const target = join(other, "other-chunks"); await fs.rename(join(f.root, "chunks"), target);
    await fs.symlink(target, join(f.root, "chunks"));
    await refused(f, "COMPILED_PATH_NOT_REGULAR_DIRECTORY");
  });

  it.each(["inside", "outside"])("refuses child file links %s the root [mutant: nofollow]", async location => {
    const f = await fixture(); await available(f);
    const other = location === "inside" ? f.root : await fs.mkdtemp(join(tmpdir(), "surface-reader-file-link-"));
    if (location === "outside") roots.push(other);
    const entry = join(f.root, f.measurement.compiled.entry), target = join(other, "entry-copy.js");
    await fs.rename(entry, target); await fs.symlink(target, entry);
    await refused(f, "ELOOP");
  });

  it.each(["../sibling/escape.js", "/absolute/escape.js", "chunks\\escape.js", "C:/escape.js"])("refuses unsafe compiled path %s", async path => {
    const f = await fixture(); await available(f);
    f.measurement.compiled = { ...f.measurement.compiled, entry: path, files: { [path]: "escape" } };
    await refused(f, "unsafe path");
  });

  it("missing or synthetic measurement stays pending [mutant: empty-success]", async () => {
    const f = await fixture(); f.engine.surfaceOptions = { packages: [], measurements: [] };
    expect(await readSelectedSurfaceRuntimeArtifacts(f)).toMatchObject({ status: "pending", needs: expect.arrayContaining([expect.stringContaining("MEASUREMENT_UNAVAILABLE")]) });
    f.engine.surfaceOptions = { packages: [], measurements: [{ ...f.measurement, scope: "synthetic" }] };
    expect(await readSelectedSurfaceRuntimeArtifacts(f)).toMatchObject({ status: "pending", needs: expect.arrayContaining([expect.stringContaining("REAL_MEASUREMENT_UNAVAILABLE")]) });
  });

  it("empty and unsigned selected surfaces stay pending without partial artifacts", async () => {
    const f = await fixture();
    expect(await readSelectedSurfaceRuntimeArtifacts({ ...f, selected: [] })).toMatchObject({ status: "pending" });
    delete f.engine.library.surfaces;
    const result = await readSelectedSurfaceRuntimeArtifacts(f); expect(result).toMatchObject({ status: "pending" }); expect(result).not.toHaveProperty("surfaces");
  });

  it("missing compiled inputs stay pending without partial surfaces [mutant: empty-success]", async () => {
    const f = await fixture(); await available(f);
    expect(await readSelectedSurfaceRuntimeArtifacts({ ...f, artifacts: [] })).toMatchObject({ status: "pending" });
    await fs.rm(join(f.root, "chunks/shared.js"));
    const missing = await readSelectedSurfaceRuntimeArtifacts(f);
    expect(missing).toMatchObject({ status: "pending", needs: ["COMPILED_ARTIFACT_UNAVAILABLE: sections.reader"] });
    expect(missing).not.toHaveProperty("surfaces");
    const absentRoot = await readSelectedSurfaceRuntimeArtifacts({ ...f, artifacts: [{ leaf: f.leaf, compiledRoot: join(f.root, "absent") }] });
    expect(absentRoot).toMatchObject({ status: "pending" }); expect(absentRoot).not.toHaveProperty("surfaces");
  });

  it("a directory cannot replace a compiled regular file", async () => {
    const f = await fixture(); await available(f);
    const path = join(f.root, "chunks/shared.js"); await fs.rm(path); await fs.mkdir(path);
    await refused(f, "COMPILED_PATH_NOT_REGULAR_FILE");
  });

  it("malformed or failed measurement remains refused rather than pending", async () => {
    const f = await fixture(); f.measurement.checks.closure = "fail";
    expect(await readSelectedSurfaceRuntimeArtifacts(f)).toMatchObject({ status: "refused" });
    f.measurement.checks.closure = "pass";
    f.measurement.compiler.sourceHash = `sha256:${"0".repeat(64)}`;
    expect(await readSelectedSurfaceRuntimeArtifacts(f)).toMatchObject({ status: "refused" });
  });

  it("freezes validated inputs before asynchronous disk reads", async () => {
    const f = await fixture(), promise = readSelectedSurfaceRuntimeArtifacts(f);
    f.measurement.compiled = { ...f.measurement.compiled, files: { [f.measurement.compiled.entry]: "foreign" } };
    const result = await promise; expect(result.status).toBe("artifacts");
    if (result.status === "artifacts") expect(runtimeSnapshot(result.surfaces[0]!.measurement)).not.toEqual(f.measurement);
  });

  it("detaches finite catalogs during pending I/O and retains original capabilities [mutant: omit-snapshot]", async () => {
    const f = await fixture(), registry = adoptedSurface(), derived = syntheticDerivation(registry);
    // Existing sanitized registry records, with observable supplied capabilities.
    // No registered capability may execute during this authored-record read.
    const transformRun = vi.fn(() => { throw new Error("unexpected transform execution"); });
    const ruleRun = vi.fn(() => { throw new Error("unexpected rule execution"); });
    const fileExists = vi.fn(() => true);
    f.engine.fileExists = fileExists;
    f.engine.catalog.surfaces!.transforms = [{ ...registry.transform, run: transformRun }];
    f.engine.catalog.surfaces!.rules = [{ ...derived.rule, run: ruleRun }];
    // Detach this test's mutable finite arrays from the shared canonical loader.
    f.engine.catalog.values = structuredClone(f.engine.catalog.values);
    const beforeValues = runtimeSnapshot(f.engine.catalog.values), beforeComponents = runtimeSnapshot(f.engine.catalog.components);
    const beforeSlots = runtimeSnapshot(f.engine.catalog.surfaces!.slots);
    const beforeTransformSource = runtimeSnapshot(f.engine.catalog.surfaces!.transforms[0]!.source);
    const beforeRuleSource = runtimeSnapshot(f.engine.catalog.surfaces!.rules[0]!.source);
    const promise = readSelectedSurfaceRuntimeArtifacts(f);
    f.engine.catalog.values.slots = [];
    f.engine.catalog.components.fills = [registry.input.catalog.components.fills[0]!];
    f.engine.catalog.surfaces!.slots = [];
    f.engine.catalog.surfaces!.transforms[0]!.source[0]!.content = "caller changed transform";
    f.engine.catalog.surfaces!.rules[0]!.source[0]!.content = "caller changed rule";
    f.engine.catalog.surfaces!.materializations = [];
    const result = await promise;
    expect(result.status, JSON.stringify(result)).toBe("artifacts");
    if (result.status !== "artifacts") throw new Error(JSON.stringify(result));
    const catalog = result.engine.catalog;
    expect(catalog).not.toBe(f.engine.catalog);
    expect(catalog.values).toEqual(beforeValues); expect(catalog.components).toEqual(beforeComponents);
    expect(catalog.surfaces!.slots).toEqual(beforeSlots);
    expect(catalog.surfaces!.transforms[0]!.source).toEqual(beforeTransformSource);
    expect(catalog.surfaces!.rules[0]!.source).toEqual(beforeRuleSource);
    expect(catalog.surfaces!.transforms[0]!.run).toBe(transformRun);
    expect(catalog.surfaces!.rules[0]!.run).toBe(ruleRun); expect(result.engine.fileExists).toBe(fileExists);
    for (const object of [catalog, catalog.values, catalog.values.slots, catalog.components, catalog.surfaces, catalog.surfaces!.slots, catalog.surfaces!.transforms, catalog.surfaces!.transforms[0], catalog.surfaces!.transforms[0]!.source, catalog.surfaces!.rules, catalog.surfaces!.rules[0], catalog.surfaces!.rules[0]!.source]) expect(Object.isFrozen(object)).toBe(true);
    expect(resolve(result.engine).check.findings.filter(row => row.severity === "error")).toEqual([]);
    expect(transformRun).not.toHaveBeenCalled(); expect(ruleRun).not.toHaveBeenCalled(); expect(fileExists).not.toHaveBeenCalled();
  });

  it("reads a selected source leaf in a library that also holds an adopted package pointer", async () => {
    const f = await fixture();
    const pkg = (importFoundrySections().fills as unknown as SurfaceCandidateDocument[]).find(doc => isSurfacePackageEntry(surfaceEntryOf(doc)))!;
    const meta = pkg.$extensions["com.clossys.fill"];
    const surfaces = f.engine.catalog.surfaces!;
    f.engine.catalog = { ...f.engine.catalog, surfaces: { ...surfaces, slots: [...loadSectionRegistry().slots.filter(slot => slot.id === meta.slot), ...surfaces.slots], fills: [pkg] } };
    const surfaceOptions = { ...f.engine.surfaceOptions!, packages: await readSurfacePackageEvidence([pkg]) };
    const adopted = applyLibraryChange(f.engine.catalog, { ...f.engine.library, adoptedAt: "2026-10-26" }, { baseHash: libraryHash({ ...f.engine.library, adoptedAt: "2026-10-26" }), changes: [{ portion: "surfaces", change: { op: "adopt", slot: meta.slot as `sections.${string}`, source: meta.source } }] }, { surfaceOptions });
    // The pointer sorts ahead of the selected source leaf, so every owned-fill lookup meets it first.
    f.engine.library = { ...adopted, surfaces: { ...adopted.surfaces!, fills: [...adopted.surfaces!.fills].sort(doc => isSurfacePackageEntry(surfaceEntryOf(doc)) ? -1 : 1) } };
    f.engine.surfaceOptions = surfaceOptions;
    expect(isSurfacePackageEntry(surfaceEntryOf(f.engine.library.surfaces!.fills[0]!))).toBe(true);
    const result = await available(f);
    expect(result.surfaces.map(row => row.leaf)).toEqual([f.leaf]);
  });

});
