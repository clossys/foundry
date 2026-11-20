/** @vitest-environment node */
import { beforeAll, expect, it } from "vitest";
import { applyLibraryChange, libraryHash, resolve } from "../catalog-core/api.js";
import { DEFAULT_COMPONENT_PREFERENCE } from "../catalog-core/component-defaults.js";
import { emitSurfaces } from "../catalog-core/surface-emit.js";
import { surfaceEntryOf } from "../catalog-core/surface-library.js";
import { retiredLeafIds } from "../catalog-core/retired-leaves.js";
import retiredLeaves from "../catalog/retired.json" with { type: "json" };
import { SPECIMEN_SECTION_EXPORTS } from "../importers/specimen-sections.js";
import { existsSync } from "node:fs";
import { dirname, relative, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INSTALLED_NATIVE_SPECIMEN_EVIDENCE, SEATED_NATIVE_SPECIMENS, checkNativeSpecimenEvidence, installedNativeSpecimenEvidence, replayNativeSpecimenEvidence, specimenSurfaceEnvironment, type NativeSpecimenEvidence } from "./qualify-specimen-surfaces.js";
import type { CompositeEngineInput } from "../catalog-core/types.js";

let input: CompositeEngineInput;
let data: NativeSpecimenEvidence;
beforeAll(async () => {
  data = await installedNativeSpecimenEvidence();
  const { prepareStudioSelection } = await import("../../../producer/dist/server/selection-defaults.js");
  input = (await prepareStudioSelection()).input;
}, 30_000);
const s8 = (engine: CompositeEngineInput) => resolve(engine).surfaces!.check.findings.filter(row => row.code === "S8" && row.severity === "error");
const evidence = () => structuredClone(data);
const retired = retiredLeafIds(retiredLeaves as unknown as Parameters<typeof retiredLeafIds>[0]);
const packageRoot = pathResolve(dirname(fileURLToPath(import.meta.url)), "../..");

it("replays the evidence the installed build carries, never a checked-in source copy", () => {
  expect(relative(packageRoot, INSTALLED_NATIVE_SPECIMEN_EVIDENCE)).toBe("dist/catalog/native-specimen-evidence.json");
  expect(existsSync(pathResolve(packageRoot, "src/catalog/native-specimen-evidence.json"))).toBe(false);
  expect(data.version).toBe(1);
});

it("seats, certifies and replays no retired native specimen", () => {
  const live = SPECIMEN_SECTION_EXPORTS.map(row => row.id).filter(id => !retired.has(id)).sort();
  expect(SPECIMEN_SECTION_EXPORTS.some(row => retired.has(row.id))).toBe(true);
  expect([...SEATED_NATIVE_SPECIMENS]).toEqual(live);
  expect(data.certificates.map(row => row.slot).sort()).toEqual(live);
  expect(input.surfaceOptions!.measurements.filter(row => retired.has(row.slot))).toEqual([]);
  expect(input.surfaceOptions!.measurements.every(row => row.scope === "real" && row.command.exitCode === 0 && row.checks.types === "pass" && row.checks.closure === "pass")).toBe(true);
  expect(Object.values(resolve(input).surfaces!.fills).filter(row => retired.has(surfaceEntryOf(row.document).slot))).toEqual([]);
  expect(s8(input)).toEqual([]);
});

it.each(["retired", "compiler", "command"] as const)("an evidence %s mutant beyond the seated inventory is refused", async kind => {
  const changed = evidence();
  const certificate = { slot: [...retired].find(id => id.startsWith("sections.specimen-"))!, source: { entry: "x.tsx", files: {}, dependencies: {} }, compiled: { entry: "x.js", files: {}, dependencies: {} }, checks: { types: "pass", closure: "pass" } } as unknown as NativeSpecimenEvidence["certificates"][number];
  if (kind === "retired") changed.certificates = [...changed.certificates, certificate];
  if (kind === "compiler" && !changed.certificates.length) changed.compiler = {} as NonNullable<NativeSpecimenEvidence["compiler"]>;
  if (kind === "compiler" && changed.certificates.length) changed.compiler = { ...changed.compiler!, sourceHash: `sha256:${"0".repeat(64)}` as const };
  if (kind === "command" && !changed.certificates.length) changed.command = {} as NonNullable<NativeSpecimenEvidence["command"]>;
  if (kind === "command" && changed.certificates.length) changed.command = { ...changed.command!, stdoutSha256: "0".repeat(64) };
  await expect(checkNativeSpecimenEvidence(changed)).rejects.toThrow("Native specimen source evidence unavailable");
  await expect(checkNativeSpecimenEvidence(evidence())).resolves.toBeUndefined();
});

it("replays only seated specimens: the current selection's measurements pass through unchanged", async () => {
  const replayed = await replayNativeSpecimenEvidence(input, evidence());
  expect(replayed.surfaceOptions!.measurements).toEqual(input.surfaceOptions!.measurements);
});

it("independently refuses an installed package artifact inventory mutant", async () => {
  const changed = evidence();
  changed.packages[0]!.artifactSha256 = "0".repeat(64);
  await expect(specimenSurfaceEnvironment(input, changed)).rejects.toThrow("installed package artifact/exports differ");
}, 15_000);

// Test-local seated inventory: one native specimen treated as live (not retired) for this fixture only.
// Every native specimen is retired in the catalog today, so this is the only way the non-empty
// certificate, compiler and command branches run. retired-leaves.ts and retired.json stay untouched.
const FIXTURE = "sections.specimen-swatch";
const FIXTURE_SEATED: readonly string[] = [FIXTURE];
let seatedFixture: Promise<{ input: CompositeEngineInput; evidence: NativeSpecimenEvidence }> | undefined;
function seatedSpecimen() {
  return seatedFixture ??= (async () => {
    const { prepareCatalogSurfaceDefaults } = await import("../catalog-bundles.js");
    // The real source-built compiler route the workspace build uses; the installed worker is what replay authenticates.
    const measure = await import("../../dist/library-cli/measure-specimen-surfaces.js");
    const prepared = await prepareCatalogSurfaceDefaults(input, { slots: [FIXTURE], preference: DEFAULT_COMPONENT_PREFERENCE }, data.dependencies);
    const decision = prepared.plan.decisions.find(row => row.slot === FIXTURE)!;
    expect(decision.source).toBe("foundry");
    // The fixture also seats the component leaves its source binds that Studio does not seat already.
    const filled = new Set(input.library.components.fills.map(fill => fill.$extensions["com.clossys.fill"].slot));
    const components = SPECIMEN_SECTION_EXPORTS.find(row => row.id === FIXTURE)!.components.filter(id => !filled.has(id));
    expect(components).toEqual(["components.specimen-swatch"]);
    const withComponents = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: components.map(slot => ({ portion: "components" as const, change: { op: "adopt" as const, slot, source: "foundry" } })) }, { surfaceOptions: input.surfaceOptions });
    const library = applyLibraryChange(prepared.input.catalog, withComponents, { baseHash: libraryHash(withComponents), changes: [{ portion: "surfaces", change: { op: "adopt", slot: FIXTURE, source: decision.source } }], surfaceBundles: prepared.surfaceBundles }, { componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions });
    const seated = { ...prepared.input, library };
    const measured = await measure.qualifySpecimenSurfaces(seated) as CompositeEngineInput;
    const rows = measured.surfaceOptions!.measurements.filter(row => row.slot === FIXTURE);
    expect(rows).toHaveLength(1);
    const evidence: NativeSpecimenEvidence = { ...structuredClone(data), compiler: rows[0]!.compiler, command: rows[0]!.command, certificates: rows.map(({ slot, source, compiled, checks }) => ({ slot, source, compiled, checks })) };
    return { input: seated, evidence };
  })();
}
const seatedEvidence = async () => structuredClone((await seatedSpecimen()).evidence);

it("a seated specimen fixture's real compiler certificate passes the certificate, compiler and command checks and replays", async () => {
  const { input: seated, evidence: certified } = await seatedSpecimen();
  expect(certified.certificates.map(row => row.slot)).toEqual([FIXTURE]);
  expect(certified.compiler).not.toBeNull();
  expect(certified.command).toMatchObject({ exitCode: 0, argv: ["node", "dist/library-cli/surface-evidence-compiler.js"] });
  await expect(checkNativeSpecimenEvidence(await seatedEvidence(), FIXTURE_SEATED)).resolves.toBeUndefined();
  // The production inventory seats no retired specimen, so the same certificate is refused there.
  await expect(checkNativeSpecimenEvidence(await seatedEvidence())).rejects.toThrow("complete unique native certificate inventory required");
  expect(s8(seated).filter(row => row.subject === FIXTURE).length).toBeGreaterThan(0);
  const replayed = await replayNativeSpecimenEvidence(seated, await seatedEvidence(), FIXTURE_SEATED);
  expect(replayed.surfaceOptions!.measurements.filter(row => row.slot === FIXTURE).map(row => row.scope)).toEqual(["real"]);
  expect(s8(replayed).filter(row => row.subject === FIXTURE)).toEqual([]);
}, 240_000);

it.each(["missing", "compiler", "command", "source", "incomplete", "closure"] as const)("a seated specimen certificate %s mutant is refused", async kind => {
  const changed = await seatedEvidence();
  const certificate = changed.certificates[0]!;
  if (kind === "missing") changed.certificates = [];
  if (kind === "compiler") changed.compiler = { ...changed.compiler!, sourceHash: `sha256:${"0".repeat(64)}` as const };
  if (kind === "command") changed.command = { ...changed.command!, stdoutSha256: "0".repeat(64) };
  if (kind === "source") certificate.source.files[certificate.source.entry] += "\n";
  if (kind === "incomplete") certificate.checks.types = "fail";
  if (kind === "closure") certificate.compiled.files[Object.keys(certificate.compiled.files)[0]!] += "\n";
  await expect(checkNativeSpecimenEvidence(changed, FIXTURE_SEATED)).rejects.toThrow("Native specimen source evidence unavailable");
}, 240_000);

it("replay refuses a seated certificate's dependency artifact mismatch against the selected closure", async () => {
  const { input: seated } = await seatedSpecimen();
  const changed = await seatedEvidence();
  const dependencies = Object.values(changed.certificates[0]!.source.dependencies);
  expect(dependencies.length).toBeGreaterThan(0);
  dependencies[0]!.artifact = `sha256:${"0".repeat(64)}`;
  await expect(replayNativeSpecimenEvidence(seated, changed, FIXTURE_SEATED)).rejects.toThrow("exact compiler source/dependency equivalence differs");
}, 240_000);

it.each(["missing", "stale", "incomplete"] as const)("S8 kills a seated specimen's %s replayed measurement", async kind => {
  const { input: seated } = await seatedSpecimen();
  const replayed = await replayNativeSpecimenEvidence(seated, await seatedEvidence(), FIXTURE_SEATED);
  const measurements = structuredClone(replayed.surfaceOptions!.measurements);
  const row = measurements.find(row => row.slot === FIXTURE)!;
  if (kind === "missing") measurements.splice(measurements.indexOf(row), 1);
  if (kind === "stale") row.identity.descriptorHash = `sha256:${"0".repeat(64)}`;
  if (kind === "incomplete") row.checks.types = "fail";
  const mutated = { ...replayed, surfaceOptions: { ...replayed.surfaceOptions!, measurements } };
  expect(s8(mutated).filter(finding => finding.subject === FIXTURE).length).toBeGreaterThan(0);
  expect(() => emitSurfaces(resolve(mutated).surfaces!, ["surface-index"])).toThrow("S8 source emission requires current complete evidence");
}, 240_000);
