import { componentSourceHash, componentTokensHash, checkComponentProfile } from "../../../catalog-core/check-components.js";
import { componentOf } from "../../../catalog-core/resolve-components.js";
import type { ComponentCheckInput, ComponentObservation } from "../../../catalog-core/check-components.js";
import type { ComponentResolutionInput } from "../../../catalog-core/resolve-components.js";
import { hash } from "./inventory.js";
import { readFileSync } from "node:fs";

/** A prior audit is reusable only with exact inputs and matrix identity, accepted externally. */
export interface AcceptedMeasurements {
  /** Both digests are supplied by the master's accepted receipt, never inferred here. */
  receipt: { path: string; sha256: string };
  acceptance: { path: string; sha256: string };
}
interface MeasurementPayload {
  bindings: Readonly<Record<string, string>>;
  emittedSourceSha256: Readonly<Record<string, string>>;
  observations: Readonly<Record<string, ComponentObservation | undefined>>;
  auditor: { artifact: { path: string; sha256: string }; report: { path: string; sha256: string }; matrix: { path: string; sha256: string } };
}
export function readMeasurements(accepted: AcceptedMeasurements): MeasurementPayload {
  const read = (file: { path: string; sha256: string }): string => {
    const bytes = readFileSync(file.path);
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || hash(bytes) !== file.sha256) throw new Error("accepted measurement payload changed");
    return bytes.toString("utf8");
  };
  const acceptance = JSON.parse(read(accepted.acceptance)) as { status?: string; measurementSha256?: string; auditorArtifactSha256?: string; reportSha256?: string; matrixSha256?: string };
  if (acceptance.status !== "accepted-independent-audit" || acceptance.measurementSha256 !== accepted.receipt.sha256) throw new Error("independent audit acceptance unavailable");
  const payload = JSON.parse(read(accepted.receipt)) as MeasurementPayload;
  for (const [key, digest] of [["artifact", acceptance.auditorArtifactSha256], ["report", acceptance.reportSha256], ["matrix", acceptance.matrixSha256]] as const) {
    const file = payload.auditor?.[key];
    if (!file || file.sha256 !== digest) throw new Error(`accepted auditor ${key} identity differs`);
    read(file);
  }
  if (!payload.bindings || !payload.observations || !payload.emittedSourceSha256 || !Object.keys(payload.emittedSourceSha256).length) throw new Error("accepted measurements or emitted source identity unavailable");
  return payload;
}
export function assertEvidenceJoin(expected: Readonly<Record<string, string>>, measured: Readonly<Record<string, string>>): void {
  if (!Object.keys(expected).length) throw new Error("empty source/evidence identity join");
  for (const [key, value] of Object.entries(expected)) {
    if (!value || measured[key] !== value) throw new Error(`source/evidence identity differs: ${key}`);
  }
}
/** Missing independent axe is unavailable, never an empty violation array. */
export function collectProfile(input: ComponentResolutionInput, bindings: Readonly<Record<string, string>>, measurements?: AcceptedMeasurements) {
  const observations: Record<string, ComponentObservation | undefined> = {};
  let availability: "accepted-audit" | "unavailable" = "unavailable";
  if (measurements) {
    const payload = readMeasurements(measurements);
    assertEvidenceJoin(bindings, payload.bindings);
    for (const doc of input.library.fills) {
      const fill = componentOf(doc), observation = payload.observations[fill.slot];
      if (!observation) continue;
      const files = fill.impl.kind === "source" ? input.library.files.filter(file => fill.outputSha256?.some(receipt => receipt.path === file.path)) : observation.files;
      if (componentSourceHash(files) !== observation.sourceHash || componentTokensHash(input.values.tokens) !== observation.tokensHash) throw new Error(`source/token measurement identity differs: ${fill.slot}`);
      if (fill.impl.kind === "source" && JSON.stringify(files.map(file => ({ path: file.path, content: file.content })).sort((a, b) => a.path.localeCompare(b.path))) !== JSON.stringify(observation.files.map(file => ({ path: file.path, content: file.content })).sort((a, b) => a.path.localeCompare(b.path)))) throw new Error(`measured facade bytes differ: ${fill.slot}`);
      observations[fill.slot] = observation;
    }
    availability = "accepted-audit";
  }
  const checkInput: ComponentCheckInput = {
    compositions: { rules: input.catalog.rules ?? [], library: input.library },
    slots: input.catalog.slots, fills: input.library.fills.map(componentOf),
    ...input.values, requiredMembers: input.requiredMembers,
    installedRac: input.evidence?.installedRac ?? { version: "", instance: "" },
    classBindings: input.evidence?.classBindings, coherenceGroups: input.evidence?.coherenceGroups,
    observations,
  };
  return { observations, check: checkComponentProfile(checkInput), axeViolations: { status: availability }, status: availability };
}
