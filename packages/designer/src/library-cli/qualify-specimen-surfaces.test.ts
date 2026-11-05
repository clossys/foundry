/** @vitest-environment node */
import { beforeAll, expect, it } from "vitest";
import { resolve } from "../catalog-core/api.js";
import { emitSurfaces } from "../catalog-core/surface-emit.js";
import { checkNativeSpecimenEvidence, replayNativeSpecimenEvidence, specimenSurfaceEnvironment, type NativeSpecimenEvidence } from "./qualify-specimen-surfaces.js";
import data from "../catalog/native-specimen-evidence.json" with { type: "json" };
import type { CompositeEngineInput } from "../catalog-core/types.js";

let input: CompositeEngineInput;
beforeAll(async () => {
  const { prepareStudioSelection } = await import("../../../producer/dist/server/selection-defaults.js");
  input = (await prepareStudioSelection()).input;
}, 30_000);
const s8 = (engine: CompositeEngineInput) => resolve(engine).surfaces!.check.findings.filter(row => row.code === "S8" && row.severity === "error");
const evidence = () => structuredClone(data) as unknown as NativeSpecimenEvidence;

it("replays all14 real compiler certificates while retaining the canonical source's separate S5 refusal", () => {
  expect(input.surfaceOptions!.measurements).toHaveLength(14);
  expect(input.surfaceOptions!.measurements.every(row => row.scope === "real" && row.command.exitCode === 0 && row.checks.types === "pass" && row.checks.closure === "pass")).toBe(true);
  expect(s8(input)).toEqual([]);
  const profile = resolve(input).surfaces!;
  expect(profile.check.findings.some(row => row.code === "S5" && row.severity === "error")).toBe(true);
  expect(() => emitSurfaces(profile, ["surface-index"])).toThrow("S8 source emission requires current complete evidence");
});

it.each(["missing", "stale", "incomplete"] as const)("unchanged S8 kills %s measurements and restored source remains complete", kind => {
  const measurements = structuredClone(input.surfaceOptions!.measurements);
  if (kind === "missing") measurements.shift();
  if (kind === "stale") measurements[0]!.identity.descriptorHash = "sha256:" + "0".repeat(64);
  if (kind === "incomplete") measurements[0]!.checks.types = "fail";
  const mutated = { ...input, surfaceOptions: { ...input.surfaceOptions!, measurements } };
  expect(s8(mutated).length).toBeGreaterThan(0);
  expect(() => emitSurfaces(resolve(mutated).surfaces!, ["surface-index"])).toThrow("S8 source emission requires current complete evidence");
  expect(s8(input)).toEqual([]);
});

it.each(["missing", "compiler", "command", "source", "incomplete"] as const)("source-built certificate %s mutant is refused", async kind => {
  const changed = evidence();
  if (kind === "missing") changed.certificates = changed.certificates.slice(1);
  if (kind === "compiler") changed.compiler.sourceHash = "sha256:" + "0".repeat(64);
  if (kind === "command") changed.command.stdoutSha256 = "0".repeat(64);
  if (kind === "source") changed.certificates[0]!.source.files[changed.certificates[0]!.source.entry] += "\n";
  if (kind === "incomplete") changed.certificates[0]!.checks.closure = "fail";
  await expect(checkNativeSpecimenEvidence(changed)).rejects.toThrow("Native specimen source evidence unavailable");
  await expect(checkNativeSpecimenEvidence(evidence())).resolves.toBeUndefined();
});

it("refuses a certificate's dependency artifact mismatch against the actual current selected closure", async () => {
  const changed = evidence(), source = changed.certificates[0]!.source;
  Object.values(source.dependencies)[0]!.artifact = "sha256:" + "0".repeat(64);
  await expect(replayNativeSpecimenEvidence(input, changed)).rejects.toThrow("exact compiler source/dependency equivalence differs");
});

it("independently refuses an installed package artifact inventory mutant", async () => {
  const changed = evidence();
  changed.packages[0]!.artifactSha256 = "0".repeat(64);
  await expect(specimenSurfaceEnvironment(input, changed)).rejects.toThrow("installed package artifact/exports differ");
}, 15_000);
