/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, unlinkSync, cpSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { productionCompositionFixture } from "../catalog-core/__fixtures__/date-picker-composition.js";
import { resolveComponents } from "../catalog-core/resolve-components.js";
import goldenValues from "../catalog-core/__golden__/resolved.foundry.json" with { type: "json" };
import { hash, fileHash, inspectDependency, assertNamedImport, assertSingleton, inventoryGraph, staticImports, packageRoot, verifyPackedArtifact, type DependencyArtifact } from "./__fixtures__/selected-module-harness/inventory.js";
import { compileFixture, strictConfig } from "./__fixtures__/selected-module-harness/compile.js";
import { collectProfile, assertEvidenceJoin, readMeasurements, type AcceptedMeasurements } from "./__fixtures__/selected-module-harness/profile.js";
import { writeFixture, createRun, assertManifest, assertFacadeIdentity, assertGlyphRoute, assertBindings, assertActualBindings } from "./__fixtures__/selected-module-harness/materialize.js";
import { calendarCaller } from "./__fixtures__/selected-module-harness/calendar-caller.js";
import { menuCaller } from "./__fixtures__/selected-module-harness/menu-caller.js";
import { dialogCaller } from "./__fixtures__/selected-module-harness/dialog-caller.js";

const packageDirectory = resolve(import.meta.dirname, "../..");
const repository = resolve(packageDirectory, "../..");
const temp = mkdtempSync(resolve(repository, ".selected-harness-"));
const artifacts: DependencyArtifact[] = [];
const inspections: { specifier: string; status: string; error?: string }[] = [];
let run: string;
const write = (name: string, value: unknown) => writeFileSync(resolve(run, `${name}.json`), JSON.stringify(value, null, 2));
const fixture = productionCompositionFixture();
const values = {
  tokens: Object.fromEntries(Object.entries(goldenValues.members).map(([id, member]) => [id, { property: member.emit, ...member.css }])),
  assets: [...new Set(fixture.library.fills.flatMap(doc => Object.values(doc.components).flatMap(fill => fill.reads.assets)))],
};

beforeAll(async () => {
  run = createRun(process.env.FOUNDRY_SELECTED_EVIDENCE_ROOT ?? resolve(temp, "evidence"), `h1-${Date.now()}-${process.pid}`);
  const sourceImports = fixture.library.files.filter(file => /\.tsx?$/.test(file.path)).flatMap(file => staticImports(file.path, file.content)).map(edge => edge.specifier).filter(name => !name.startsWith("."));
  const hostImports = [calendarCaller, menuCaller, dialogCaller].flatMap(source => staticImports("host.tsx", source)).map(edge => edge.specifier).filter(name => !name.startsWith("."));
  for (const specifier of [...new Set([...sourceImports, ...hostImports, "typescript", "esbuild"])].sort()) {
    try {
      artifacts.push(await inspectDependency(specifier, resolve(packageDirectory, "package.json"), resolve(repository, "package-lock.json")));
      inspections.push({ specifier, status: artifacts.at(-1)!.closureStatus });
    } catch (error) { inspections.push({ specifier, status: "refused", error: String(error) }); }
  }
  write("dependency-exports", { status: "inspection-only", lockSha256: fileHash(resolve(repository, "package-lock.json")), artifacts, inspections, lockIntegrityMeaning: "lock claim; installed entry bytes are independently hashed" });
  write("dependency-claims-reconciliation", {
    status: "repair-unavailable", before: fixture.library.fills.map(doc => Object.values(doc.components)[0]!).map(fill => ({ slot: fill.slot, deps: fill.deps, rac: fill.rac })),
    observed: artifacts.map(artifact => ({ name: artifact.name, version: artifact.version, root: artifact.root, entrySha256: artifact.entrySha256 })),
    graph: sourceImports, after: { status: "unavailable", reason: "source/profile owner must accept derived claim repair; H1 observes only" },
    selectedPackageArtifact: { status: "unavailable", reason: "no emitted cohort: real Calendar materialization prerequisite refuses; no package source fallback mounted" },
  });
}, 120_000);

afterAll(() => {
  write("receipt", { version: 1, identity: `h1-${process.pid}`, run, status: "refusal-tests-only", emittedCohort: "unavailable", axeViolations: { status: "unavailable" }, inspections });
  // Evidence requested by the caller is retained; only this test's own temp tree is removed.
  if (process.env.FOUNDRY_SELECTED_EVIDENCE_ROOT) rmSync(temp, { recursive: true, force: true });
});

describe("real selected-module harness refusal contracts", () => {
  it("independently enumerates actual dependency runtime and erased type exports", () => {
    const react = artifacts.find(row => row.specifier === "react");
    const rac = artifacts.find(row => row.specifier === "react-aria-components");
    expect(react, JSON.stringify(inspections)).toBeDefined(); expect(rac, JSON.stringify(inspections)).toBeDefined();
    expect(react!.version).toBe("19.3.0"); expect(rac!.version).toBe("1.21.1");
    for (const name of ["Select", "SelectValue", "ListBox", "ListBoxSection", "ListBoxItem", "Button", "Popover", "Header", "SearchField", "Separator", "composeRenderProps", "Menu", "MenuItem", "MenuSection", "SubmenuTrigger", "Autocomplete", "Dialog", "Modal", "ModalOverlay", "Heading"]) expect(rac!.runtimeNames).toContain(name);
    expect(react!.typeNames).toContain("ReactNode"); expect(react!.runtimeNames).not.toContain("ReactNode");
    expect(rac!.typeNames).toContain("SelectProps"); expect(rac!.runtimeNames).not.toContain("SelectProps");
    expect(rac!.integrity).toBe("sha512-J88WflYY0z+EhLX0ce+GjFlQ3ag3ubIgfUTjpKSrBQBu92Xtl4Ub9o118HItUddtbk1Ido0jzyPy94/klZy1hg==");
  });
  it("distinguishes missing runtime, erased type, and value-only imports", () => {
    const rac = artifacts.find(row => row.specifier === "react-aria-components")!;
    expect(() => assertNamedImport(rac, "SelectProps", false)).toThrow("missing runtime export");
    expect(() => assertNamedImport(rac, "NotAnInstalledType", true)).toThrow("missing type export");
    expect(() => assertNamedImport({ runtimeNames: ["ValueOnly"], typeNames: [] }, "ValueOnly", true)).toThrow("missing type export");
  });
  it("refuses foreign copied RAC physical roots even at the same version", () => {
    const react = artifacts.find(row => row.specifier === "react")!, rac = artifacts.find(row => row.specifier === "react-aria-components")!;
    const foreign = resolve(temp, "foreign-rac"); cpSync(rac.root, foreign, { recursive: true });
    const foreignEntry = resolve(foreign, rac.entry.slice(rac.root.length + 1));
    expect(fileHash(foreignEntry)).toBe(rac.entrySha256);
    expect(packageRoot(foreignEntry).data.version).toBe(rac.version);
    expect(() => assertSingleton([{ specifier: "react", packageRoot: react.root }, { specifier: "react-aria-components", packageRoot: rac.root }, { specifier: "react-aria-components", packageRoot: realpathSync(foreign) }])).toThrow("physical singleton identity differs");
  });
  it("refuses a changed materialized byte against its retained manifest", () => {
    const file = fixture.library.files[0]!;
    const manifest = writeFixture(temp, [file], [], {}, "source-measurement-only");
    writeFileSync(resolve(manifest.root, file.path), `${file.content}\n`);
    expect(() => assertManifest(manifest)).toThrow("materialized byte differs");
  });
  it("refuses missing files before treating a graph as closed", () => {
    const file = fixture.library.files[0]!;
    const manifest = writeFixture(temp, [file], [], {}, "source-measurement-only");
    unlinkSync(resolve(manifest.root, file.path));
    expect(() => assertManifest(manifest)).toThrow("missing file in materialized closure");
  });
  it("independently refuses the real source's missing selected Icon facade", () => {
    const manifest = writeFixture(temp, fixture.library.files, [], {}, "source-measurement-only");
    expect(() => inventoryGraph(manifest.root, manifest.files.filter(row => /\.tsx?$/.test(row.path)).map(row => resolve(manifest.root, row.path)))).toThrow(/missing type target|missing file/);
  });
  it("keeps unsupported dynamic imports refused while inventorying closed dependency literals", () => {
    expect(() => staticImports("control.ts", 'const name = "foreign"; import(name)')).toThrow("not a closed static graph");
    expect(staticImports("control.js", 'const react = require("react")', true)[0]!.specifier).toBe("react");
    expect(() => staticImports("control.js", "require(variable)", true)).toThrow("not a closed static graph");
    expect(() => staticImports("control.ts", 'declare module "react" { export type Fake = string }')).toThrow("ambient module stub");
  });
  it("runs real TypeScript and esbuild on exact source-only G1 files and retains refusal", async () => {
    const files = fixture.library.files;
    const manifest = writeFixture(temp, files, [{ path: "package.json", content: '{"type":"module"}' }, { path: "tsconfig.json", content: strictConfig(files.filter(row => /\.tsx?$/.test(row.path)).map(row => row.path)) }], {}, "source-measurement-only");
    const calendar = files.find(file => file.path === "components/calendar/calendar.tsx")!;
    const compiled = await compileFixture(manifest, [calendar.path]);
    expect(compiled.compiler.version).toBe("6.0.3"); expect(compiled.bundle.version).toBe("0.28.2");
    expect(compiled.status).toBe("refused"); expect(compiled.diagnostics.length).toBeGreaterThan(0); expect(compiled.bundle.errors.length).toBeGreaterThan(0);
    expect(compiled.closureError).toMatch(/missing/);
    write("compile-diagnostics", { ...compiled, evidenceClass: "source-measurement-only", moduleManifest: manifest });
    write("module-manifest", manifest);
    write("bundle-metafile", compiled.metafile ?? { status: "refused", errors: compiled.bundle.errors });
  }, 60_000);
  it("retains the real resolver source prerequisite refusal before emission", () => {
    const collected = collectProfile({ ...fixture, values }, {});
    expect(collected.status).toBe("unavailable"); expect(collected.axeViolations).toEqual({ status: "unavailable" }); expect(collected.observations).toEqual({});
    expect(collected.check.ok).toBe(false);
    expect(() => resolveComponents({ ...fixture, values })).toThrow("blocked materialization components.calendar");
    write("component-check", { ...collected, resolver: { status: "refused", reason: "blocked materialization components.calendar" }, emission: { status: "unavailable", reason: "real resolver prerequisite refused" } });
    write("source-measurements", { status: "source-measurement-only", source: fixture.library.files.map(file => ({ path: file.path, sha256: hash(file.content) })), runtime: "unavailable", axeViolations: { status: "unavailable" } });
  });
  it("refuses missing glyph indexes and provider omission", () => {
    expect(() => assertGlyphRoute(fixture.library.files, values.assets)).toThrow("glyph/index/provider route unavailable");
    // Deliberately incomplete route control: it cannot be used as an emitted fixture.
    const broken = [{ path: "assets/glyphs.ts", content: 'export const glyphs = {"assets.icon-check":{}}' }, { path: "components/icon/index.ts", content: "glyphs[asset]" }, { path: "component-index.ts", content: "export const LibraryProvider = null" }];
    expect(() => assertGlyphRoute(broken, ["assets.icon-check"])).toThrow("glyph/provider route differs");
    expect(() => assertGlyphRoute(broken, ["assets.icon-foreign"])).toThrow("glyph/provider route differs");
    expect(() => assertGlyphRoute(broken, [])).toThrow("glyph/index/provider route unavailable");
  });
  it("kills a bypass of the source/evidence identity assertion", () => {
    const manifest = writeFixture(temp, [fixture.library.files[0]!], [], {}, "source-measurement-only");
    const hashes = Object.fromEntries(manifest.files.map(file => [file.path, file.sha256]));
    hashes[manifest.files[0]!.path] = "0".repeat(64);
    expect(() => assertFacadeIdentity(manifest, hashes)).toThrow("source/evidence identity differs");
    expect(() => assertEvidenceJoin({ selection: "actual" }, { selection: "different" })).toThrow("source/evidence identity differs");
  });
  it("rejects plausible-shaped identity claims that differ from actual input hashes", () => {
    const binding = "0".repeat(64);
    const names = ["descriptor", "adoption", "api", "selection", "source", "output", "token", "glyph", "dependency", "compiler", "css"];
    const expected = Object.fromEntries(names.map(name => [name, binding])); expected.acceptedTree = "0".repeat(40);
    expect(() => assertBindings(expected)).not.toThrow();
    for (const name of names) expect(() => assertActualBindings(expected, { [name]: "1".repeat(64) })).toThrow(`actual input identity differs: ${name}`);
  });
  it.each(["observations", "report", "matrix"])("refuses changed %s with an unchanged accepted receipt", field => {
    const directory = mkdtempSync(resolve(temp, "audit-negative-"));
    const file = (name: string, content: unknown) => { const path = resolve(directory, name); const text = JSON.stringify(content); writeFileSync(path, text); return { path, sha256: hash(text) }; };
    const artifact = file("auditor", { status: "negative-control" }), report = file("report", {}), matrix = file("matrix", {});
    const receipt = file("receipt", { bindings: {}, observations: {}, auditor: { artifact, report, matrix } });
    const acceptance = file("acceptance", { status: "accepted-independent-audit", measurementSha256: receipt.sha256, auditorArtifactSha256: artifact.sha256, reportSha256: report.sha256, matrixSha256: matrix.sha256 });
    const accepted: AcceptedMeasurements = { receipt, acceptance };
    if (field === "observations") { const payload = JSON.parse(readFileSync(receipt.path, "utf8")); payload.observations.changed = {}; writeFileSync(receipt.path, JSON.stringify(payload)); }
    else writeFileSync(({ report, matrix })[field].path, "changed");
    expect(() => readMeasurements(accepted)).toThrow("accepted measurement payload changed");
  });
  it("refuses an archive digest mismatch before inspecting any extracted package", () => {
    const archive = resolve(temp, "wrong.tgz"); writeFileSync(archive, "not an accepted archive");
    expect(() => verifyPackedArtifact(archive, "0".repeat(64), temp)).toThrow("archive identity differs");
  });
  it("retains exact selected-leaf caller imports and actual provider mounts", () => {
    for (const source of [calendarCaller, menuCaller, dialogCaller]) {
      expect(source).toContain("<LibraryProvider>"); expect(source).not.toMatch(/__fixtures__|@clossys\/designer|components\/.*\/(?:calendar|dropdown-menu|dialog)\.js/);
    }
    expect(calendarCaller).toContain('SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "../components/select/index.js"');
    expect(menuCaller).toContain('import { MenuTrigger } from "react-aria-components"');
    expect(dialogCaller).toContain("showCloseButton={false}"); expect(dialogCaller).toContain('slot="close">Dismiss command');
  });
  it("refuses overwriting a prior runtime evidence run", () => {
    const root = resolve(temp, "overwrite-control"); createRun(root, "same-run");
    expect(() => createRun(root, "same-run")).toThrow(/EEXIST/);
  });
});
