/** Replay real source-built compiler facts only after exact current input equivalence. No runtime compiler. */
import data from "../catalog/native-specimen-evidence.json" with { type: "json" };
import { readFile } from "node:fs/promises";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "../catalog-core/api.js";
import { bindSurfaceSource } from "../catalog-core/surface-bindings.js";
import { isSurfacePackageEntry, surfaceEntryOf, surfaceOf } from "../catalog-core/surface-library.js";
import { surfaceRuntimeIdentity } from "../catalog-core/surface-check.js";
import { runtimeHash, runtimeSourceFindings } from "../catalog-core/runtime-ports.js";
import { sha256 } from "../catalog-core/digest.js";
import { stableStringify } from "../catalog-core/stable.js";
import { SPECIMEN_SECTION_EXPORTS } from "../importers/specimen-sections.js";
import { installedSurfaceDependency } from "./surface-installed-dependencies.js";
import type { CompositeEngineInput } from "../catalog-core/types.js";
import type { SurfaceCommandReceipt, SurfaceDependency, SurfaceMeasurement, SurfacePackageEvidence } from "../catalog-core/surface-types.js";

export interface NativeSpecimenEvidence {
  version: 1;
  packages: readonly SurfacePackageEvidence[];
  dependencies: readonly SurfaceDependency[];
  compiler: SurfaceMeasurement["compiler"];
  command: SurfaceCommandReceipt;
  certificates: readonly Pick<SurfaceMeasurement, "slot" | "source" | "compiled" | "checks">[];
}
const shipped = data as unknown as NativeSpecimenEvidence;
const fail = (message: string): never => { throw new Error(`Native specimen source evidence unavailable: ${message}`); };
const native = SPECIMEN_SECTION_EXPORTS.map(row => row.id).sort();
const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

/** Verify the actual compiler command/logs, exact compiler source, inputs, declarations and emitted bytes. */
export async function checkNativeSpecimenEvidence(evidence: NativeSpecimenEvidence): Promise<void> {
  if (evidence.version !== 1 || !same(evidence.certificates.map(row => row.slot).sort(), native)) fail("complete unique native certificate inventory required");
  if (runtimeSourceFindings(evidence.compiler).length) fail("compiler source identity differs");
  const files = evidence.compiler.source.files;
  const compiler = await readFile(pathResolve(dirname(fileURLToPath(import.meta.url)), "../../dist/library-cli/surface-evidence-compiler.js"), "utf8");
  if (files[evidence.compiler.source.entry] !== compiler) fail("installed compiler producer differs");
  if (evidence.command.exitCode !== 0 || !same(evidence.command.argv, ["node", "dist/library-cli/surface-evidence-compiler.js"]) || evidence.command.stdoutSha256 !== sha256(files["compiler-stdout.json"] ?? "") || evidence.command.stderrSha256 !== sha256(files["compiler-stderr.txt"] ?? "")) fail("completed compiler command/log identity differs");
  const result = JSON.parse(files["compiler-stdout.json"]!) as { outputs: Record<string, string>; manifest: { version: string; compilerSha256: string; options: Record<string, unknown>; inputs: { path: string; sha256: string }[] } };
  const manifest = JSON.parse(files["invocation-manifest.json"]!);
  const inputManifest = JSON.parse(files["input-manifest.json"]!) as { path: string; sha256: string }[];
  if (!same(result.manifest, manifest) || manifest.options.strict !== true || manifest.options.noEmitOnError !== true || !manifest.inputs.length || evidence.compiler.source.dependencies.typescript?.version !== manifest.version || evidence.compiler.source.dependencies.typescript?.artifact !== `sha256:${manifest.compilerSha256}`) fail("compiler options/declaration input identity differs");
  const source: Record<string, string> = {}, compiled: Record<string, string> = {};
  for (const certificate of evidence.certificates) {
    if (certificate.checks.types !== "pass" || certificate.checks.closure !== "pass") fail(`${certificate.slot}: incomplete compiler evidence`);
    for (const [path, text] of Object.entries(certificate.source.files)) {
      if (Object.hasOwn(source, path) && source[path] !== text) fail("source input collision");
      source[path] = text;
      const output = path.replace(/\.tsx?$/, ".js");
      if (certificate.compiled.files[output] !== result.outputs[output]) fail(`${certificate.slot}: compiled input/output equivalence differs`);
      compiled[output] = certificate.compiled.files[output]!;
      if (manifest.inputs.filter((row: { path: string; sha256: string }) => row.path === `.surface-evidence/${path}` && row.sha256 === sha256(text)).length !== 1) fail(`${certificate.slot}: actual compiler input differs`);
    }
    if (!same(Object.keys(certificate.compiled.files).sort(), Object.keys(certificate.source.files).map(path => path.replace(/\.tsx?$/, ".js")).sort())) fail(`${certificate.slot}: compiled closure inventory differs`);
  }
  const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);
  if (!same([...inputManifest].sort(byPath), Object.entries(source).map(([path, text]) => ({ path, sha256: sha256(text) })).sort(byPath)) || !same(compiled, result.outputs)) fail("completed compiler program source/output inventory differs");
}

/** Independent installed package authentication; no TypeScript or development-only package is loaded. */
export async function specimenSurfaceEnvironment(input: CompositeEngineInput, evidence: NativeSpecimenEvidence = shipped) {
  await checkNativeSpecimenEvidence(evidence);
  const installed = await Promise.all(evidence.packages.map(row => installedSurfaceDependency(row.module)));
  if (new Set(evidence.packages.map(row => row.module)).size !== evidence.packages.length || !same(installed.map(row => row.dependency), evidence.dependencies)) fail("dependency inventory differs");
  for (const [index, row] of evidence.packages.entries()) {
    const actual = installed[index]!;
    if (row.version !== actual.dependency.version || row.artifactSha256 !== actual.artifactSha256 || !same(row.values, actual.values)) fail(`installed package artifact/exports differ: ${row.module}`);
  }
  const modules = new Set(evidence.packages.map(row => row.module));
  const packageExports = { ...input.componentOptions?.packageExports, ...Object.fromEntries(installed.map(row => [row.dependency.module, row.values])) };
  return { dependencies: evidence.dependencies, input: { ...input, componentOptions: { ...input.componentOptions, packageExports }, surfaceOptions: { packages: [...(input.surfaceOptions?.packages ?? []).filter(row => !modules.has(row.module)), ...evidence.packages], measurements: input.surfaceOptions?.measurements ?? [] } } };
}

/** Current identities are computed only for byte-identical compiler inputs; S2/S5/S8 remain authoritative. */
export async function replayNativeSpecimenEvidence(input: CompositeEngineInput, evidence: NativeSpecimenEvidence): Promise<CompositeEngineInput> {
  await checkNativeSpecimenEvidence(evidence);
  const profile = resolve(input);
  const measurements: SurfaceMeasurement[] = [];
  for (const row of Object.values(profile.surfaces?.fills ?? {}).filter(row => native.includes(surfaceEntryOf(row.document).slot as typeof native[number]))) {
    if (isSurfacePackageEntry(surfaceEntryOf(row.document))) fail("a native specimen must retain its source");
    const fill = surfaceOf(row.document), certificate = evidence.certificates.find(row => row.slot === fill.slot)!;
    const owned = input.library.surfaces!.files.filter(file => fill.outputSha256.some(pin => pin.path === file.path));
    const bound = bindSurfaceSource(fill, owned, profile, input.surfaceOptions!.packages);
    if (bound.proof.findings.length) fail(`${fill.slot}: selected source closure differs`);
    const source = { entry: fill.impl.entry, files: Object.fromEntries([...owned.filter(file => file.path.match(/\.tsx?$/)), ...bound.componentFiles.filter(file => fill.bindings.length && file.path !== "component-index.ts")].map(file => [file.path, file.content])), dependencies: Object.fromEntries(bound.packages.map(pkg => [pkg.module, { version: pkg.version, artifact: `sha256:${pkg.artifactSha256}` }])) };
    if (!same(source, certificate.source) || !same(source.dependencies, certificate.compiled.dependencies)) fail(`${fill.slot}: exact compiler source/dependency equivalence differs; regenerate evidence for this selection`);
    measurements.push({ version: 1, slot: fill.slot, scope: "real", identity: surfaceRuntimeIdentity(row), source: certificate.source, compiled: certificate.compiled, compiler: evidence.compiler, command: evidence.command, checks: certificate.checks, runtime: null });
  }
  const qualified = { ...input, surfaceOptions: { ...input.surfaceOptions!, measurements: [...input.surfaceOptions!.measurements.filter(row => !native.includes(row.slot as typeof native[number])), ...measurements] } };
  const findings = resolve(qualified).surfaces!.check.findings.filter(row => row.code === "S8" && row.severity === "error");
  if (findings.length) fail(JSON.stringify(findings));
  return qualified;
}
export async function qualifySpecimenSurfaces(input: CompositeEngineInput): Promise<CompositeEngineInput> { return replayNativeSpecimenEvidence(input, shipped); }
