import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { materializeSourceFill, applyComponentLibraryChange } from "../../../catalog-core/changeset-components.js";
import { resolveComponents, componentLibraryHash } from "../../../catalog-core/resolve-components.js";
import { componentSourceHash, componentTokensHash } from "../../../catalog-core/check-components.js";
import { stableStringify } from "../../../catalog-core/stable.js";
import ts from "typescript";
import { version as esbuildVersion } from "esbuild";
import { emitComponents } from "../../../catalog-core/emit-components.js";
import type { ComponentFetchPort, ComponentTransform, ComponentChangeSet } from "../../../catalog-core/changeset-components.js";
import type { ComponentResolutionInput, ComponentFile } from "../../../catalog-core/resolve-components.js";
import type { ComponentEmitOptions } from "../../../catalog-core/emit-components.js";
import { hash, fileHash, inside, inventoryGraph, assertNamedImport, type DependencyArtifact } from "./inventory.js";
import { collectProfile, assertEvidenceJoin, readMeasurements, type AcceptedMeasurements } from "./profile.js";
import { strictConfig } from "./compile.js";
import { calendarCaller } from "./calendar-caller.js";
import { menuCaller } from "./menu-caller.js";
import { dialogCaller } from "./dialog-caller.js";

export interface ModuleManifest {
  version: 1; status: "emitted" | "source-measurement-only"; root: string;
  bindings: Readonly<Record<string, string>>;
  files: { path: string; sha256: string; kind: "emitted" | "host" }[];
}
export interface CohortInput {
  input: ComponentResolutionInput;
  /** Master-bound immutable identities; no local path constant is an identity. */
  bindings: Readonly<Record<string, string>>;
  acceptedSource: { path: string; sha256: string };
  cssPath: string;
  dependencies: readonly DependencyArtifact[];
  measurements?: AcceptedMeasurements;
  glyphModule: NonNullable<ComponentEmitOptions["glyphModule"]>;
  caller: "calendar" | "menu" | "dialog";
  tempParent: string; runDirectory: string;
  materialization?: { fetch: ComponentFetchPort; transforms: readonly ComponentTransform[]; changes: ComponentChangeSet };
}
const requiredBindings = ["acceptedTree", "descriptor", "adoption", "api", "selection", "source", "output", "token", "glyph", "dependency", "compiler", "css"];
export function assertBindings(bindings: Readonly<Record<string, string>>): void {
  for (const name of requiredBindings) if (!(name === "acceptedTree" ? /^[a-f0-9]{40}$/ : /^(?:sha256:)?[a-f0-9]{64}$/).test(bindings[name] ?? "")) throw new Error(`missing accepted identity: ${name}`);
}
export function actualBindings(cohort: Pick<CohortInput, "input" | "dependencies" | "glyphModule" | "cssPath">): Record<string, string> {
  const descriptors = cohort.input.library.fills.map(doc => Object.values(doc.components)[0]!).sort((a, b) => a.slot.localeCompare(b.slot));
  for (const artifact of cohort.dependencies) {
    if (artifact.closureStatus !== "observed") throw new Error(`dependency compiled closure unavailable: ${artifact.specifier}`);
    if (fileHash(artifact.entry) !== artifact.entrySha256 || fileHash(artifact.typeEntry) !== artifact.typeSha256 || fileHash(resolve(artifact.root, "package.json")) !== artifact.packageSha256 || artifact.compiledFiles.some(file => fileHash(file.path) !== file.sha256)) throw new Error(`dependency artifact bytes changed: ${artifact.specifier}`);
  }
  return {
    descriptor: hash(stableStringify(descriptors.map(({ origin: _origin, ...fill }) => fill))),
    adoption: hash(stableStringify(descriptors.map(fill => ({ slot: fill.slot, origin: fill.origin })))),
    api: hash(stableStringify(descriptors.map(fill => ({ slot: fill.slot, impl: fill.impl, secondaryExports: fill.secondaryExports ?? [] })))),
    selection: componentLibraryHash(cohort.input.library),
    source: componentSourceHash(cohort.input.library.files),
    output: hash(stableStringify(cohort.input.library.files.map(file => ({ path: file.path, sha256: hash(file.content) })).sort((a, b) => a.path.localeCompare(b.path)))),
    token: componentTokensHash(cohort.input.values.tokens), glyph: hash(stableStringify(cohort.glyphModule)),
    dependency: hash(stableStringify(cohort.dependencies)),
    compiler: hash(stableStringify({ typescript: ts.version, typescriptSha256: fileHash(new URL(import.meta.resolve("typescript")).pathname), esbuild: esbuildVersion, esbuildSha256: fileHash(new URL(import.meta.resolve("esbuild")).pathname) })),
    css: fileHash(cohort.cssPath),
  };
}
export function assertActualBindings(expected: Readonly<Record<string, string>>, actual: Readonly<Record<string, string>>): void {
  for (const [name, digest] of Object.entries(actual)) if ((expected[name] ?? "").replace(/^sha256:/, "") !== digest.replace(/^sha256:/, "")) throw new Error(`actual input identity differs: ${name}`);
}
export function assertManifest(manifest: ModuleManifest): void {
  const paths = new Set<string>();
  for (const file of manifest.files) {
    const path = resolve(manifest.root, file.path);
    if (!inside(manifest.root, path) || paths.has(file.path)) throw new Error(`unsafe or duplicate manifest path: ${file.path}`);
    paths.add(file.path);
    if (!existsSync(path)) throw new Error(`missing file in materialized closure: ${file.path}`);
    if (fileHash(path) !== file.sha256) throw new Error(`materialized byte differs: ${file.path}`);
  }
}
export function assertFacadeIdentity(manifest: ModuleManifest, measurements: Readonly<Record<string, string>>): void {
  const emitted = Object.fromEntries(manifest.files.filter(file => file.kind === "emitted" && /\.tsx?$/.test(file.path)).map(file => [file.path, file.sha256]));
  assertEvidenceJoin(emitted, measurements);
}
export function assertGlyphRoute(files: readonly ComponentFile[], assets: readonly string[]): void {
  const glyphs = files.find(file => file.path === "assets/glyphs.ts");
  const icon = files.find(file => file.path === "components/icon/index.ts");
  const provider = files.find(file => file.path === "component-index.ts");
  if (!assets.length || !glyphs || !icon || !provider) throw new Error("selected glyph/index/provider route unavailable");
  if (assets.some(asset => !glyphs.content.includes(JSON.stringify(asset))) || !icon.content.includes("glyphs[asset]") || !provider.content.includes("GlyphProvider") || !provider.content.includes("LibraryProvider")) throw new Error("selected glyph/provider route differs");
}
/** Only writes exact emitter results and explicit host/config bytes into a new owned folder. */
export function writeFixture(parent: string, emitted: readonly ComponentFile[], host: readonly ComponentFile[], bindings: Readonly<Record<string, string>>, status: ModuleManifest["status"] = "emitted"): ModuleManifest {
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(resolve(parent, "selected-module-"));
  const files: ModuleManifest["files"] = [];
  for (const [kind, rows] of [["emitted", emitted], ["host", host]] as const) for (const file of rows) {
    const target = resolve(root, file.path);
    if (!inside(root, target) || files.some(row => row.path === file.path)) throw new Error("fixture path conflict or escape");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, { flag: "wx" });
    files.push({ path: file.path, sha256: hash(file.content), kind });
  }
  const manifest: ModuleManifest = { version: 1, status, root, bindings, files };
  writeFileSync(resolve(root, "module-manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
  return manifest;
}
export function createRun(evidenceRoot: string, identity: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(identity)) throw new Error("unsafe run identity");
  mkdirSync(evidenceRoot, { recursive: true });
  const run = resolve(evidenceRoot, identity);
  mkdirSync(run); // EEXIST is a refusal: never overwrite a previous run.
  const unavailable = { status: "unavailable", reason: "not measured in this run" };
  for (const name of ["dependency-exports", "dependency-claims-reconciliation", "module-manifest", "source-measurements", "component-check", "compile-diagnostics", "bundle-metafile", "browser-environment", "browser-observations", "caller-events", "mutants"]) writeFileSync(resolve(run, `${name}.json`), JSON.stringify(unavailable), { flag: "wx" });
  writeFileSync(resolve(run, "commands.jsonl"), "", { flag: "wx" });
  writeFileSync(resolve(run, "receipt.json"), JSON.stringify({ version: 1, identity, run, status: "unavailable", createdAt: new Date().toISOString() }, null, 2), { flag: "wx" });
  return run;
}
export async function materializeCohort(cohort: CohortInput): Promise<ModuleManifest> {
  assertBindings(cohort.bindings);
  let library = cohort.input.library;
  if (cohort.materialization) {
    const bundles = [];
    for (const operation of cohort.materialization.changes.changes) if (operation.op === "adopt") {
      const doc = cohort.input.catalog.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === operation.slot && doc.$extensions["com.clossys.fill"].source === operation.source);
      const fill = doc?.components[operation.slot.slice(11)];
      if (fill?.impl.kind === "source") bundles.push(await materializeSourceFill(fill, cohort.materialization.fetch, cohort.materialization.transforms));
    }
    library = applyComponentLibraryChange(cohort.input.catalog, library, cohort.materialization.changes, bundles);
  }
  if (!library.fills.length) throw new Error("empty cohort cannot establish selected runtime");
  const acceptedBytes = readFileSync(cohort.acceptedSource.path);
  if (hash(acceptedBytes) !== cohort.acceptedSource.sha256) throw new Error("accepted source receipt changed");
  const accepted = JSON.parse(acceptedBytes.toString("utf8")) as { status?: string; tree?: string; bindings?: Record<string, string> };
  if (accepted.status !== "accepted-source-only" || accepted.tree !== cohort.bindings.acceptedTree || !accepted.bindings) throw new Error("accepted source provenance unavailable");
  assertEvidenceJoin(cohort.bindings, accepted.bindings);
  assertActualBindings(cohort.bindings, actualBindings({ ...cohort, input: { ...cohort.input, library } }));
  const packageExports = Object.fromEntries(cohort.dependencies.map(artifact => [artifact.specifier, [...new Set([...artifact.runtimeNames, ...artifact.typeNames])].sort()]));
  const rac = cohort.dependencies.find(artifact => artifact.specifier === "react-aria-components");
  if (!rac) throw new Error("independently observed RAC artifact unavailable");
  if (cohort.input.evidence?.installedRac && (cohort.input.evidence.installedRac.version !== rac.version || cohort.input.evidence.installedRac.instance !== rac.root)) throw new Error("installed RAC claim differs from actual physical artifact");
  const input = { ...cohort.input, library, packageExports, evidence: { ...cohort.input.evidence, observations: {}, installedRac: { version: rac.version, instance: rac.root } } };
  const collected = collectProfile(input, cohort.bindings, cohort.measurements);
  writeFileSync(resolve(cohort.runDirectory, "component-check.json"), JSON.stringify({ ...collected, bindings: cohort.bindings }, null, 2));
  const profile = resolveComponents({ ...input, evidence: { ...input.evidence, installedRac: input.evidence?.installedRac ?? { version: "", instance: "" }, observations: collected.observations } });
  // Real resolver/check results are kept; there is no check.ok override or unchecked emitter.
  const emitted = emitComponents(profile, ["component-index", "notices", "components-consumption"], { glyphModule: cohort.glyphModule });
  assertGlyphRoute(emitted, Object.values(profile.components).flatMap(component => component.reads.assets));
  const caller = { calendar: calendarCaller, menu: menuCaller, dialog: dialogCaller }[cohort.caller];
  const host = [{ path: `harness/${cohort.caller}-caller.tsx`, content: caller }, { path: "package.json", content: '{"private":true,"type":"module"}\n' }];
  const configFiles = [...emitted, ...host].filter(file => /\.tsx?$/.test(file.path)).map(file => file.path);
  host.push({ path: "tsconfig.json", content: strictConfig(configFiles) });
  const manifest = writeFixture(cohort.tempParent, emitted, host, cohort.bindings);
  if (!cohort.measurements) throw new Error("accepted emitted source measurements unavailable");
  assertFacadeIdentity(manifest, readMeasurements(cohort.measurements).emittedSourceSha256);
  const packageArtifact = cohort.dependencies.find(artifact => artifact.specifier === "@clossys/designer/components");
  if (Object.values(profile.components).some(component => component.impl.kind === "package" && component.impl.module === "@clossys/designer/components")) {
    if (!packageArtifact?.archive) throw new Error("selected package leaf requires the exact accepted archive artifact");
    const scope = resolve(manifest.root, "node_modules/@clossys");
    mkdirSync(scope, { recursive: true });
    symlinkSync(packageArtifact.root, resolve(scope, "designer"), "dir");
  }
  assertManifest(manifest);
  const edges = inventoryGraph(manifest.root, manifest.files.filter(row => /\.tsx?$/.test(row.path)).map(row => resolve(manifest.root, row.path)));
  for (const edge of edges.filter(edge => !edge.specifier.startsWith("."))) {
    const artifact = cohort.dependencies.find(artifact => artifact.specifier === edge.specifier);
    if (!artifact) throw new Error(`uninspected dependency: ${edge.specifier}`);
    for (const name of edge.names) assertNamedImport(artifact, name.name, name.typeOnly);
  }
  writeFileSync(resolve(cohort.runDirectory, "module-manifest.json"), JSON.stringify({ ...manifest, edges }, null, 2));
  return manifest;
}
