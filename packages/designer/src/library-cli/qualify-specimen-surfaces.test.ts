/** @vitest-environment node */
import { beforeAll, expect, it } from "vitest";
import { resolve } from "../catalog-core/api.js";
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
