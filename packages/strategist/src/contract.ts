/**
 * The public, product-neutral strategy contract.
 *
 * This is deliberately a data contract, not a copy catalog or rendering
 * format. Consumer repositories author their own records, while downstream
 * packages receive only stable references and the provenance needed to say
 * which governed strategy informed an output. There are no UI, copy, or
 * surface imports here.
 */

import { createHash } from "node:crypto";
import {
  isPlainObject,
  optionalString,
  optionalStringArray,
  pushIssue,
  requireArrayOf,
  requirePattern,
  requireString,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

/** Stable identifiers are portable across files, labels, and consumers. */
const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** Records use semantic versions so a downstream artifact can name an exact governing revision. */
const REVISION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const STRATEGY_RECORD_KINDS = [
  "product",
  "brand",
  "audience",
  "positioning",
  "claim",
  "evidence",
  "constraint",
] as const;

export type StrategyRecordKind = (typeof STRATEGY_RECORD_KINDS)[number];
export type ClaimStatus = "approved" | "hypothesis";
export type EvidenceKind = "observed-fact" | "research";
export type ConstraintKind = "presentation-guidance" | "claim-governance" | "audience-protection";
export type ConstraintTarget = "copy" | "surface" | "all";

/** Source-level provenance required on every strategy record. */
export interface RecordProvenance {
  /** Stable locator supplied by the consumer, such as a research-record id or source URL. */
  source: string;
  /** Date the source was recorded or rechecked. */
  recordedAt: string;
  /** Optional revision assigned by the source system itself. */
  sourceRevision?: string;
}

export interface StrategyRecordBase {
  kind: StrategyRecordKind;
  id: string;
  revision: string;
  provenance: RecordProvenance;
}

export interface ProductRecord extends StrategyRecordBase {
  kind: "product";
  name: string;
  summary: string;
}

export interface BrandRecord extends StrategyRecordBase {
  kind: "brand";
  productId: string;
  name: string;
  essence: string;
}

export interface AudienceRecord extends StrategyRecordBase {
  kind: "audience";
  productId: string;
  name: string;
  description: string;
}

export interface PositioningRecord extends StrategyRecordBase {
  kind: "positioning";
  productId: string;
  audienceIds: string[];
  category: string;
  differentiation: string;
  reasonToBelieveClaimIds: string[];
}

export interface ApprovedClaimApproval {
  approvedBy: string;
  approvedAt: string;
}

/** A claim approved for audience-facing use; it must cite one or more evidence records. */
export interface ApprovedClaimRecord extends StrategyRecordBase {
  kind: "claim";
  productId: string;
  /** Stable semantic key; two live records cannot govern the same product/key pair. */
  claimKey: string;
  assertion: string;
  status: "approved";
  evidenceIds: string[];
  approval: ApprovedClaimApproval;
  audienceIds?: string[];
}

/** A candidate assertion. Downstream presentation must not treat this as an approved claim. */
export interface HypothesisClaimRecord extends StrategyRecordBase {
  kind: "claim";
  productId: string;
  claimKey: string;
  assertion: string;
  status: "hypothesis";
  evidenceIds?: string[];
  audienceIds?: string[];
}

export type ClaimRecord = ApprovedClaimRecord | HypothesisClaimRecord;

/** Evidence records hold observations/research separately from governed public assertions. */
export interface EvidenceRecord extends StrategyRecordBase {
  kind: "evidence";
  productId: string;
  evidenceKind: EvidenceKind;
  statement: string;
  observedAt?: string;
}

/** Presentation guidance is a constraint, never an executable UI or renderer instruction. */
export interface ConstraintRecord extends StrategyRecordBase {
  kind: "constraint";
  productId: string;
  constraintKind: ConstraintKind;
  target: ConstraintTarget;
  instruction: string;
  claimIds?: string[];
  audienceIds?: string[];
}

export type StrategyRecord =
  | ProductRecord
  | BrandRecord
  | AudienceRecord
  | PositioningRecord
  | ClaimRecord
  | EvidenceRecord
  | ConstraintRecord;

/** The versioned strategy document a consumer passes into its own adapters. */
export interface StrategyContract {
  id: string;
  revision: string;
  provenance: RecordProvenance;
  records: StrategyRecord[];
}

/** Small, dependency-free payload safe to attach to copy/surface output manifests. */
export interface StrategyRecordReference {
  kind: StrategyRecordKind;
  id: string;
  revision: string;
}

export interface StrategyProvenance {
  strategyId: string;
  revision: string;
  records: StrategyRecordReference[];
  /** SHA-256 of `serializeStrategyContract(contract)`, not a security signature. */
  fingerprint: string;
}

function readId(value: unknown, path: string, issues: ValidationIssue[]): string | undefined {
  const id = requireString(value, path, issues, { minLength: 1 });
  if (id !== undefined) requirePattern(id, path, issues, ID_RE, 'must be a stable kebab-case id, e.g. "research-teams"');
  return id;
}

function readRevision(value: unknown, path: string, issues: ValidationIssue[]): string | undefined {
  const revision = requireString(value, path, issues, { minLength: 1 });
  if (revision !== undefined) requirePattern(revision, path, issues, REVISION_RE, 'must be a semantic version, e.g. "1.2.0"');
  return revision;
}

function readDate(value: unknown, path: string, issues: ValidationIssue[]): string | undefined {
  const date = requireString(value, path, issues, { minLength: 1 });
  if (date !== undefined) requirePattern(date, path, issues, ISO_DATE_RE, "must be an ISO date (YYYY-MM-DD)");
  return date;
}

function readProvenance(value: unknown, path: string, issues: ValidationIssue[]): RecordProvenance | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const source = requireString(value.source, `${path}.source`, issues, { minLength: 1 });
  const recordedAt = readDate(value.recordedAt, `${path}.recordedAt`, issues);
  const sourceRevision = optionalString(value.sourceRevision, `${path}.sourceRevision`, issues, { minLength: 1 });
  if (issues.length > start) return undefined;
  return { source: source as string, recordedAt: recordedAt as string, sourceRevision };
}

function readBase(value: unknown, path: string, issues: ValidationIssue[]): Omit<StrategyRecordBase, "kind"> & { kind: StrategyRecordKind } | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const kindValue = value.kind;
  const kind = typeof kindValue === "string" && (STRATEGY_RECORD_KINDS as readonly string[]).includes(kindValue)
    ? (kindValue as StrategyRecordKind)
    : undefined;
  if (kind === undefined) pushIssue(issues, `${path}.kind`, `must be one of ${STRATEGY_RECORD_KINDS.join(", ")}`);
  const id = readId(value.id, `${path}.id`, issues);
  const revision = readRevision(value.revision, `${path}.revision`, issues);
  const provenance = readProvenance(value.provenance, `${path}.provenance`, issues);
  if (issues.length > start) return undefined;
  return { kind: kind as StrategyRecordKind, id: id as string, revision: revision as string, provenance: provenance as RecordProvenance };
}

function readProduct(value: unknown, path: string, issues: ValidationIssue[]): ProductRecord | undefined {
  const start = issues.length;
  const base = readBase(value, path, issues);
  if (!isPlainObject(value) || base?.kind !== "product") {
    if (base !== undefined && base.kind !== "product") pushIssue(issues, `${path}.kind`, 'must be "product"');
    return undefined;
  }
  const name = requireString(value.name, `${path}.name`, issues, { minLength: 1 });
  const summary = requireString(value.summary, `${path}.summary`, issues, { minLength: 10 });
  if (issues.length > start) return undefined;
  return { ...base, kind: "product", name: name as string, summary: summary as string };
}

function readBrand(value: unknown, path: string, issues: ValidationIssue[]): BrandRecord | undefined {
  const start = issues.length;
  const base = readBase(value, path, issues);
  if (!isPlainObject(value) || base?.kind !== "brand") {
    if (base !== undefined && base.kind !== "brand") pushIssue(issues, `${path}.kind`, 'must be "brand"');
    return undefined;
  }
  const productId = readId(value.productId, `${path}.productId`, issues);
  const name = requireString(value.name, `${path}.name`, issues, { minLength: 1 });
  const essence = requireString(value.essence, `${path}.essence`, issues, { minLength: 10 });
  if (issues.length > start) return undefined;
  return { ...base, kind: "brand", productId: productId as string, name: name as string, essence: essence as string };
}

function readAudience(value: unknown, path: string, issues: ValidationIssue[]): AudienceRecord | undefined {
  const start = issues.length;
  const base = readBase(value, path, issues);
  if (!isPlainObject(value) || base?.kind !== "audience") {
    if (base !== undefined && base.kind !== "audience") pushIssue(issues, `${path}.kind`, 'must be "audience"');
    return undefined;
  }
  const productId = readId(value.productId, `${path}.productId`, issues);
  const name = requireString(value.name, `${path}.name`, issues, { minLength: 1 });
  const description = requireString(value.description, `${path}.description`, issues, { minLength: 10 });
  if (issues.length > start) return undefined;
  return { ...base, kind: "audience", productId: productId as string, name: name as string, description: description as string };
}

function readPositioning(value: unknown, path: string, issues: ValidationIssue[]): PositioningRecord | undefined {
  const start = issues.length;
  const base = readBase(value, path, issues);
  if (!isPlainObject(value) || base?.kind !== "positioning") {
    if (base !== undefined && base.kind !== "positioning") pushIssue(issues, `${path}.kind`, 'must be "positioning"');
    return undefined;
  }
  const productId = readId(value.productId, `${path}.productId`, issues);
  const audienceIds = requireArrayOf(value.audienceIds, `${path}.audienceIds`, issues, readId, { minLength: 1 });
  const category = requireString(value.category, `${path}.category`, issues, { minLength: 1 });
  const differentiation = requireString(value.differentiation, `${path}.differentiation`, issues, { minLength: 10 });
  const reasonToBelieveClaimIds = requireArrayOf(value.reasonToBelieveClaimIds, `${path}.reasonToBelieveClaimIds`, issues, readId, { minLength: 1 });
  if (issues.length > start) return undefined;
  return { ...base, kind: "positioning", productId: productId as string, audienceIds: audienceIds as string[], category: category as string, differentiation: differentiation as string, reasonToBelieveClaimIds: reasonToBelieveClaimIds as string[] };
}

function readClaim(value: unknown, path: string, issues: ValidationIssue[]): ClaimRecord | undefined {
  const start = issues.length;
  const base = readBase(value, path, issues);
  if (!isPlainObject(value) || base?.kind !== "claim") {
    if (base !== undefined && base.kind !== "claim") pushIssue(issues, `${path}.kind`, 'must be "claim"');
    return undefined;
  }
  const productId = readId(value.productId, `${path}.productId`, issues);
  const claimKey = readId(value.claimKey, `${path}.claimKey`, issues);
  const assertion = requireString(value.assertion, `${path}.assertion`, issues, { minLength: 10 });
  const audienceIds = optionalStringArray(value.audienceIds, `${path}.audienceIds`, issues, { itemMinLength: 1 });
  if (audienceIds !== undefined) audienceIds.forEach((id, index) => requirePattern(id, `${path}.audienceIds[${index}]`, issues, ID_RE, "must be a stable kebab-case id"));
  const status = value.status;
  if (status !== "approved" && status !== "hypothesis") {
    pushIssue(issues, `${path}.status`, 'must be "approved" or "hypothesis"');
  }
  if (status === "approved") {
    const evidenceIds = requireArrayOf(value.evidenceIds, `${path}.evidenceIds`, issues, readId, { minLength: 1 });
    let approval: ApprovedClaimApproval | undefined;
    if (!isPlainObject(value.approval)) {
      pushIssue(issues, `${path}.approval`, "must be an object for an approved claim");
    } else {
      const approvedBy = requireString(value.approval.approvedBy, `${path}.approval.approvedBy`, issues, { minLength: 1 });
      const approvedAt = readDate(value.approval.approvedAt, `${path}.approval.approvedAt`, issues);
      if (approvedBy !== undefined && approvedAt !== undefined) approval = { approvedBy, approvedAt };
    }
    if (issues.length > start) return undefined;
    return { ...base, kind: "claim", productId: productId as string, claimKey: claimKey as string, assertion: assertion as string, status, evidenceIds: evidenceIds as string[], approval: approval as ApprovedClaimApproval, audienceIds };
  }
  if (value.approval !== undefined) pushIssue(issues, `${path}.approval`, "must be absent for a hypothesis");
  const evidenceIds = optionalStringArray(value.evidenceIds, `${path}.evidenceIds`, issues, { itemMinLength: 1 });
  if (evidenceIds !== undefined) evidenceIds.forEach((id, index) => requirePattern(id, `${path}.evidenceIds[${index}]`, issues, ID_RE, "must be a stable kebab-case id"));
  if (issues.length > start) return undefined;
  return { ...base, kind: "claim", productId: productId as string, claimKey: claimKey as string, assertion: assertion as string, status: "hypothesis", evidenceIds, audienceIds };
}

function readEvidence(value: unknown, path: string, issues: ValidationIssue[]): EvidenceRecord | undefined {
  const start = issues.length;
  const base = readBase(value, path, issues);
  if (!isPlainObject(value) || base?.kind !== "evidence") {
    if (base !== undefined && base.kind !== "evidence") pushIssue(issues, `${path}.kind`, 'must be "evidence"');
    return undefined;
  }
  const productId = readId(value.productId, `${path}.productId`, issues);
  const evidenceKind = value.evidenceKind;
  if (evidenceKind !== "observed-fact" && evidenceKind !== "research") pushIssue(issues, `${path}.evidenceKind`, 'must be "observed-fact" or "research"');
  const statement = requireString(value.statement, `${path}.statement`, issues, { minLength: 10 });
  const observedAt = value.observedAt === undefined ? undefined : readDate(value.observedAt, `${path}.observedAt`, issues);
  if (issues.length > start) return undefined;
  return { ...base, kind: "evidence", productId: productId as string, evidenceKind: evidenceKind as EvidenceKind, statement: statement as string, observedAt };
}

function readConstraint(value: unknown, path: string, issues: ValidationIssue[]): ConstraintRecord | undefined {
  const start = issues.length;
  const base = readBase(value, path, issues);
  if (!isPlainObject(value) || base?.kind !== "constraint") {
    if (base !== undefined && base.kind !== "constraint") pushIssue(issues, `${path}.kind`, 'must be "constraint"');
    return undefined;
  }
  const productId = readId(value.productId, `${path}.productId`, issues);
  const constraintKind = value.constraintKind;
  if (constraintKind !== "presentation-guidance" && constraintKind !== "claim-governance" && constraintKind !== "audience-protection") {
    pushIssue(issues, `${path}.constraintKind`, "must be presentation-guidance, claim-governance, or audience-protection");
  }
  const target = value.target;
  if (target !== "copy" && target !== "surface" && target !== "all") pushIssue(issues, `${path}.target`, 'must be "copy", "surface", or "all"');
  const instruction = requireString(value.instruction, `${path}.instruction`, issues, { minLength: 10 });
  const claimIds = optionalStringArray(value.claimIds, `${path}.claimIds`, issues, { itemMinLength: 1 });
  const audienceIds = optionalStringArray(value.audienceIds, `${path}.audienceIds`, issues, { itemMinLength: 1 });
  for (const [field, ids] of [["claimIds", claimIds], ["audienceIds", audienceIds]] as const) {
    ids?.forEach((id, index) => requirePattern(id, `${path}.${field}[${index}]`, issues, ID_RE, "must be a stable kebab-case id"));
  }
  if (issues.length > start) return undefined;
  return { ...base, kind: "constraint", productId: productId as string, constraintKind: constraintKind as ConstraintKind, target: target as ConstraintTarget, instruction: instruction as string, claimIds, audienceIds };
}

function readRecord(value: unknown, path: string, issues: ValidationIssue[]): StrategyRecord | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  switch (value.kind) {
    case "product": return readProduct(value, path, issues);
    case "brand": return readBrand(value, path, issues);
    case "audience": return readAudience(value, path, issues);
    case "positioning": return readPositioning(value, path, issues);
    case "claim": return readClaim(value, path, issues);
    case "evidence": return readEvidence(value, path, issues);
    case "constraint": return readConstraint(value, path, issues);
    default:
      pushIssue(issues, `${path}.kind`, `must be one of ${STRATEGY_RECORD_KINDS.join(", ")}`);
      return undefined;
  }
}

function expectProductReference(
  id: string,
  known: ReadonlyMap<string, StrategyRecord>,
  path: string,
  issues: ValidationIssue[],
): void {
  const record = known.get(id);
  if (record === undefined) pushIssue(issues, path, `references missing record "${id}"`);
  else if (record.kind !== "product") pushIssue(issues, path, `references "${id}" (${record.kind}), expected a product`);
}

function expectSameProductReferences(
  ids: readonly string[] | undefined,
  expectedKind: StrategyRecordKind,
  productId: string,
  known: ReadonlyMap<string, StrategyRecord>,
  path: string,
  issues: ValidationIssue[],
): void {
  ids?.forEach((id, index) => {
    const record = known.get(id);
    if (record === undefined) {
      pushIssue(issues, `${path}[${index}]`, `references missing record "${id}"`);
    } else if (record.kind !== expectedKind) {
      pushIssue(issues, `${path}[${index}]`, `references "${id}" (${record.kind}), expected a ${expectedKind}`);
    } else if (record.kind !== "product" && record.productId !== productId) {
      pushIssue(issues, `${path}[${index}]`, `references "${id}" from product "${record.productId}", expected product "${productId}"`);
    }
  });
}

function rejectDuplicateReferences(ids: readonly string[] | undefined, path: string, issues: ValidationIssue[]): void {
  const seen = new Map<string, number>();
  ids?.forEach((id, index) => {
    const first = seen.get(id);
    if (first !== undefined) pushIssue(issues, `${path}[${index}]`, `duplicate reference "${id}" (first seen at index ${first})`);
    else seen.set(id, index);
  });
}

function validateReferences(records: readonly StrategyRecord[], issues: ValidationIssue[]): void {
  const known = new Map<string, StrategyRecord>();
  const seen = new Map<string, number>();
  records.forEach((record, index) => {
    const first = seen.get(record.id);
    if (first !== undefined) pushIssue(issues, `records[${index}].id`, `duplicate record id "${record.id}" (first seen at index ${first})`);
    else {
      seen.set(record.id, index);
      known.set(record.id, record);
    }
  });

  const claimKeys = new Map<string, number>();
  const positioningByAudience = new Map<string, number>();
  records.forEach((record, index) => {
    const basePath = `records[${index}]`;
    if (record.kind === "product") return;
    expectProductReference(record.productId, known, `${basePath}.productId`, issues);
    switch (record.kind) {
      case "brand":
      case "evidence":
        return;
      case "audience":
        return;
      case "positioning": {
        const key = `${record.productId}:${[...record.audienceIds].sort().join(",")}`;
        const first = positioningByAudience.get(key);
        if (first !== undefined) pushIssue(issues, `${basePath}.audienceIds`, `conflicting positioning record for the same product/audience set (first seen at index ${first})`);
        else positioningByAudience.set(key, index);
        expectSameProductReferences(record.audienceIds, "audience", record.productId, known, `${basePath}.audienceIds`, issues);
        expectSameProductReferences(record.reasonToBelieveClaimIds, "claim", record.productId, known, `${basePath}.reasonToBelieveClaimIds`, issues);
        rejectDuplicateReferences(record.audienceIds, `${basePath}.audienceIds`, issues);
        rejectDuplicateReferences(record.reasonToBelieveClaimIds, `${basePath}.reasonToBelieveClaimIds`, issues);
        return;
      }
      case "claim": {
        const key = `${record.productId}:${record.claimKey}`;
        const first = claimKeys.get(key);
        if (first !== undefined) pushIssue(issues, `${basePath}.claimKey`, `conflicting claim key "${record.claimKey}" for product "${record.productId}" (first seen at index ${first})`);
        else claimKeys.set(key, index);
        expectSameProductReferences(record.evidenceIds, "evidence", record.productId, known, `${basePath}.evidenceIds`, issues);
        expectSameProductReferences(record.audienceIds, "audience", record.productId, known, `${basePath}.audienceIds`, issues);
        rejectDuplicateReferences(record.evidenceIds, `${basePath}.evidenceIds`, issues);
        rejectDuplicateReferences(record.audienceIds, `${basePath}.audienceIds`, issues);
        return;
      }
      case "constraint":
        expectSameProductReferences(record.claimIds, "claim", record.productId, known, `${basePath}.claimIds`, issues);
        expectSameProductReferences(record.audienceIds, "audience", record.productId, known, `${basePath}.audienceIds`, issues);
        rejectDuplicateReferences(record.claimIds, `${basePath}.claimIds`, issues);
        rejectDuplicateReferences(record.audienceIds, `${basePath}.audienceIds`, issues);
        return;
    }
  });
}

/**
 * Validates an entire strategy contract. It is deterministic: validation
 * findings follow input order, then reference order, and never throw.
 */
export function validateStrategyContract(value: unknown): ValidationResult<StrategyContract> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) return { ok: false, issues: [{ path: "(root)", message: "must be an object" }] };
  const id = readId(value.id, "id", issues);
  const revision = readRevision(value.revision, "revision", issues);
  const provenance = readProvenance(value.provenance, "provenance", issues);
  const records = requireArrayOf(value.records, "records", issues, readRecord, { minLength: 1 });
  if (records !== undefined) validateReferences(records, issues);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { id: id as string, revision: revision as string, provenance: provenance as RecordProvenance, records: records as StrategyRecord[] } };
}

/** Returns only claims that have passed strategy approval and carry evidence links. */
export function getApprovedClaims(contract: StrategyContract): ApprovedClaimRecord[] {
  return contract.records.filter((record): record is ApprovedClaimRecord => record.kind === "claim" && record.status === "approved");
}

function normalizedRecord(record: StrategyRecord): StrategyRecord {
  switch (record.kind) {
    case "positioning": return { ...record, audienceIds: [...record.audienceIds].sort(), reasonToBelieveClaimIds: [...record.reasonToBelieveClaimIds].sort() };
    case "claim": return { ...record, evidenceIds: record.evidenceIds === undefined ? undefined : [...record.evidenceIds].sort(), audienceIds: record.audienceIds === undefined ? undefined : [...record.audienceIds].sort() } as ClaimRecord;
    case "constraint": return { ...record, claimIds: record.claimIds === undefined ? undefined : [...record.claimIds].sort(), audienceIds: record.audienceIds === undefined ? undefined : [...record.audienceIds].sort() };
    default: return { ...record };
  }
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}

/**
 * Canonical JSON for a validated contract. Record and reference ordering do
 * not change the result; the output is suitable for stable review diffs and
 * content fingerprints, not as a signed assertion of authenticity.
 */
export function serializeStrategyContract(contract: StrategyContract): string {
  const normalized: StrategyContract = {
    ...contract,
    records: contract.records.map(normalizedRecord).sort((left, right) => left.id.localeCompare(right.id)),
  };
  return JSON.stringify(sortObject(normalized));
}

/** Builds the compact provenance payload a consumer can carry into an output manifest. */
export function createStrategyProvenance(contract: StrategyContract, recordIds?: readonly string[]): StrategyProvenance {
  const requested = recordIds === undefined ? undefined : new Set(recordIds);
  const records = contract.records
    .filter((record) => requested === undefined || requested.has(record.id))
    .map((record) => ({ kind: record.kind, id: record.id, revision: record.revision }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    strategyId: contract.id,
    revision: contract.revision,
    records,
    fingerprint: createHash("sha256").update(serializeStrategyContract(contract)).digest("hex"),
  };
}
