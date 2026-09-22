/**
 * Projects a validated `StrategyBundle` into the portable `StrategyContract`
 * downstream packages seal against. Evidence records are synthesized from each
 * claim's basis (and optional fact refs) — consumers do not author a second file.
 */

import {
  validateStrategyContract,
  type ApprovedClaimRecord,
  type ClaimRecord,
  type ConstraintRecord,
  type EvidenceRecord,
  type RecordProvenance,
  type StrategyContract,
  type StrategyRecord,
} from "./contract.js";
import type { ValidationResult } from "./validation.js";
import type { StrategyBundle } from "./reader.js";
import type { StrategistClaim, StrategyConstraint } from "./schema.js";

const RECORD_REVISION = "1.0.0";
const SOURCE = "strategy-directory";

function slugId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function latestRecordedAt(bundle: StrategyBundle): string {
  let latest = "1970-01-01";
  for (const fact of bundle.facts) {
    if (fact.lastUpdatedAt > latest) latest = fact.lastUpdatedAt;
  }
  for (const entity of bundle.directions ?? []) {
    if (entity.decidedOn > latest) latest = entity.decidedOn;
  }
  return latest;
}

function recordProvenance(bundle: StrategyBundle): RecordProvenance {
  return { source: SOURCE, recordedAt: latestRecordedAt(bundle), sourceRevision: RECORD_REVISION };
}

function evidenceForClaim(
  claim: StrategistClaim,
  productId: string,
  provenance: RecordProvenance,
  factLabels: Map<string, string>,
): { evidence: EvidenceRecord[]; evidenceIds: string[] } {
  const evidence: EvidenceRecord[] = [];
  const evidenceIds: string[] = [];
  if (claim.basis !== undefined) {
    const id = `${claim.id}-basis`;
    evidence.push({
      kind: "evidence",
      id,
      revision: RECORD_REVISION,
      provenance,
      productId,
      evidenceKind: "research",
      statement: claim.basis,
    });
    evidenceIds.push(id);
  }
  for (const factRef of claim.factRefs ?? []) {
    const id = `${claim.id}-fact-${factRef}`;
    evidence.push({
      kind: "evidence",
      id,
      revision: RECORD_REVISION,
      provenance,
      productId,
      evidenceKind: "observed-fact",
      statement: factLabels.get(factRef) ?? `Observed fact ${factRef}.`,
      observedAt: provenance.recordedAt,
    });
    evidenceIds.push(id);
  }
  return { evidence, evidenceIds };
}

function constraintRecord(
  constraint: StrategyConstraint,
  productId: string,
  provenance: RecordProvenance,
): ConstraintRecord {
  return {
    kind: "constraint",
    id: constraint.id,
    revision: RECORD_REVISION,
    provenance,
    productId,
    constraintKind: "presentation-guidance",
    target: constraint.target,
    instruction: constraint.instruction,
  };
}

export function projectStrategyContract(bundle: StrategyBundle): StrategyContract {
  if (bundle.positioning === undefined || bundle.brand === undefined) {
    throw new Error("projectStrategyContract requires positioning.json and brand.json");
  }

  const productId = slugId(bundle.positioning.productName) || "product";
  const contractId = `${productId}-strategy`;
  const provenance = recordProvenance(bundle);
  const factLabels = new Map(bundle.facts.map((fact) => [fact.key, fact.label]));
  const records: StrategyRecord[] = [];

  records.push({
    kind: "product",
    id: productId,
    revision: RECORD_REVISION,
    provenance,
    name: bundle.positioning.productName,
    summary: bundle.positioning.weAre,
  });

  records.push({
    kind: "brand",
    id: `${productId}-brand`,
    revision: RECORD_REVISION,
    provenance,
    productId,
    name: bundle.positioning.productName,
    essence: bundle.brand.essence.statement,
  });

  for (const audience of bundle.audiences ?? []) {
    records.push({
      kind: "audience",
      id: audience.id,
      revision: RECORD_REVISION,
      provenance,
      productId,
      name: audience.name,
      description: `${audience.situation} Pains: ${audience.pains.join("; ")}`,
    });
  }

  const approved: ApprovedClaimRecord[] = [];
  for (const claim of bundle.claims ?? []) {
    const { evidence, evidenceIds } = evidenceForClaim(claim, productId, provenance, factLabels);
    records.push(...evidence);
    if (claim.status === "approved") {
      const approvedRecord: ApprovedClaimRecord = {
        kind: "claim",
        id: claim.id,
        revision: RECORD_REVISION,
        provenance,
        productId,
        claimKey: claim.id,
        assertion: claim.assertion,
        status: "approved",
        evidenceIds,
        approval: { approvedBy: "strategy-directory", approvedAt: provenance.recordedAt },
        audienceIds: claim.audienceIds,
      };
      approved.push(approvedRecord);
      records.push(approvedRecord);
    } else {
      const hypothesis: ClaimRecord = {
        kind: "claim",
        id: claim.id,
        revision: RECORD_REVISION,
        provenance,
        productId,
        claimKey: claim.id,
        assertion: claim.assertion,
        status: "hypothesis",
        evidenceIds: evidenceIds.length > 0 ? evidenceIds : undefined,
        audienceIds: claim.audienceIds,
      };
      records.push(hypothesis);
    }
  }

  records.push({
    kind: "positioning",
    id: `${productId}-positioning`,
    revision: RECORD_REVISION,
    provenance,
    productId,
    audienceIds: [...bundle.positioning.audienceIds],
    category: bundle.positioning.category,
    differentiation: `${bundle.positioning.weAre} — unlike ${bundle.positioning.unlike}`,
    reasonToBelieveClaimIds: [...bundle.positioning.claimIds],
  });

  for (const constraint of bundle.constraints ?? []) {
    records.push(constraintRecord(constraint, productId, provenance));
  }

  return {
    id: contractId,
    revision: RECORD_REVISION,
    provenance,
    records,
  };
}

export function projectAndValidateStrategyContract(bundle: StrategyBundle): ValidationResult<StrategyContract> {
  const contract = projectStrategyContract(bundle);
  return validateStrategyContract(contract);
}
