import { componentDescriptorDigest, componentSourceHash, type ComponentCheckFill, type ComponentObservation } from "./check-components.js";
import type { ComponentBrowserArtifact } from "./component-observations.js";
import { sha256 } from "./digest.js";
import { stableStringify } from "./stable.js";

/**
 * The per-slot qualification join: does one slot's browser artifact bind to exactly the adopted descriptor,
 * the observed source and consumer tokens, and the persisted observation built from it?
 *
 * The join is identity only. It never repeats a `check` verdict: K-code findings (token binding, forwarding,
 * focus, contrast, geometry, ...) stay `check` findings and do not fail the join, and a joined slot is not a
 * qualified slot until its check findings also clear. Exactly one record is emitted per adopted slot, joined or not.
 */
export interface ComponentQualificationJoinInput {
  /** Adopted descriptors, one per slot (e.g. `componentOf` of each library fill). */
  fills: readonly ComponentCheckFill[];
  /** The persisted observations (`componentOptions.evidence.observations`). */
  observations: Readonly<Record<string, ComponentObservation | undefined>>;
  /** Per-slot browser artifacts the observations were built from, keyed by slot. */
  artifacts: Readonly<Record<string, ComponentBrowserArtifact | undefined>>;
}
export interface ComponentQualificationJoinRecord {
  slot: string;
  joined: boolean;
  /** Why the join failed; empty when joined. */
  reasons: readonly string[];
  /** `componentDescriptorDigest` of the adopted descriptor. */
  descriptorHash: string;
  sourceHash?: string; tokensHash?: string;
  /** Digest of the persisted observation the artifact joined. */
  observationHash?: string;
}
export interface ComponentQualificationJoin {
  /** One record per adopted slot, sorted by slot. */
  records: readonly ComponentQualificationJoinRecord[];
  /** Artifacts keyed by a slot with no adopted descriptor. */
  stray: readonly string[];
}

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const same = (a: unknown, b: unknown): boolean => stableStringify(a ?? null) === stableStringify(b ?? null);

function reasonsFor(fill: ComponentCheckFill, descriptorHash: string, observation: ComponentObservation | undefined, artifact: ComponentBrowserArtifact | undefined): string[] {
  const reasons: string[] = [];
  if (!observation) reasons.push("No persisted observation for the slot");
  if (!artifact) reasons.push("No browser artifact for the slot");
  if (!observation || !artifact) return reasons;
  if (artifact.slot !== fill.slot) reasons.push(`Artifact slot ${artifact.slot} differs from ${fill.slot}`);
  if (artifact.descriptorHash !== descriptorHash) reasons.push("Artifact was measured for a different descriptor");
  if (observation.descriptorHash !== artifact.descriptorHash) reasons.push("Observation does not carry the artifact's descriptor");
  if (observation.sourceHash !== componentSourceHash(observation.files)) reasons.push("Observation source hash differs from its observed bytes");
  if (artifact.sourceHash !== observation.sourceHash) reasons.push("Artifact was measured for different source bytes");
  if (artifact.tokensHash !== observation.tokensHash) reasons.push("Artifact was measured for different consumer tokens");
  if (!artifact.rac || artifact.rac.version !== observation.rac.version || artifact.rac.instance !== observation.rac.instance) reasons.push("Artifact react-aria-components identity differs from the observation");
  if (artifact.forwardsRef !== observation.forwardsRef || artifact.forwardsRenderProps !== observation.forwardsRenderProps) reasons.push("Observation forwarding differs from the artifact");
  const members = artifact.memberMeasurements ?? {};
  if (!artifact.measurements.length && !Object.values(members).some(rows => rows.length)) reasons.push("Artifact carries no measurement");
  if (!same(observation.measurements, artifact.measurements)) reasons.push("Observation measurements differ from the artifact");
  const observedMembers = Object.fromEntries(Object.entries(observation.memberObservations ?? {}).map(([member, row]) => [member, row.measurements]));
  if (!same(observedMembers, members)) reasons.push("Observation member-root measurements differ from the artifact");
  if (!same(observation.geometry, artifact.geometry)) reasons.push("Observation geometry differs from the artifact");
  return reasons;
}

/** Join each adopted slot's browser artifact to its descriptor and persisted observation; one record per slot. */
export function joinComponentQualification(input: ComponentQualificationJoinInput): ComponentQualificationJoin {
  const slots = new Set(input.fills.map(fill => fill.slot));
  const records = [...input.fills].sort((a, b) => compare(a.slot, b.slot)).map((fill): ComponentQualificationJoinRecord => {
    const observation = input.observations[fill.slot], artifact = input.artifacts[fill.slot];
    const descriptorHash = componentDescriptorDigest(fill);
    const reasons = reasonsFor(fill, descriptorHash, observation, artifact);
    return {
      slot: fill.slot, joined: reasons.length === 0, reasons, descriptorHash,
      ...(observation ? { sourceHash: observation.sourceHash, tokensHash: observation.tokensHash, observationHash: sha256(stableStringify(observation)) } : {}),
    };
  });
  if (new Set(records.map(record => record.slot)).size !== records.length) throw new Error("Qualification join requires exactly one adopted descriptor per slot");
  return { records, stray: Object.keys(input.artifacts).filter(slot => input.artifacts[slot] && !slots.has(slot)).sort(compare) };
}
