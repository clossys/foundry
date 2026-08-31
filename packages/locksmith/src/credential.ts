import type { SecretKey } from "./types.js";

/** The two lifecycle classes Locksmith can judge without seeing a credential value. */
export type CredentialClass = "ephemeral-job" | "manually-rotatable";
export type CredentialProvider = "github-actions" | "github";

/**
 * The closed GitHub permission vocabulary this credential lifecycle slice can
 * currently assess. Extend it deliberately when a new consumer use case is
 * covered; arbitrary provider strings are not evidence of bounded scope.
 */
export type CredentialScope =
  | "contents:read"
  | "id-token:write"
  | "packages:read"
  | "packages:write";

export type CredentialVerdict = "satisfied" | "violated" | "indeterminate";
export type CredentialExitCode = 0 | 1 | 2;

/**
 * Evidence for a provider-created credential whose lifetime is the job's
 * lifetime. There is deliberately no issued-at, expiry, token, or value field:
 * the provider's job-lifetime semantics are the evidence instead.
 */
export interface EphemeralJobCredentialEvidence {
  readonly key: SecretKey;
  readonly credentialClass: "ephemeral-job";
  readonly provider: "github-actions";
  readonly scope: readonly CredentialScope[];
  readonly jobStartedAt: string;
  readonly jobEndedAt: string;
  readonly expiresAtJobEnd: true;
  readonly scopedUseObserved: true;
}

/**
 * Evidence for a credential an owner must rotate manually. Provider metadata
 * is kept separate from owner-controlled provenance: a repository secret's
 * updated-at timestamp alone is never treated as token rotation evidence.
 */
export interface ManuallyRotatableCredentialEvidence {
  readonly key: SecretKey;
  readonly credentialClass: "manually-rotatable";
  readonly provider: "github";
  readonly scope: readonly Exclude<CredentialScope, "id-token:write">[];
  readonly repositorySecretUpdatedAt?: string | null;
  readonly ownerProvenance: {
    readonly source: "owner-controlled";
    readonly tokenCreatedAt: string;
    readonly observedAt: string;
  } | null;
}

export type CredentialEvidence =
  | EphemeralJobCredentialEvidence
  | ManuallyRotatableCredentialEvidence;

export type CredentialReason =
  | "invalid-evidence"
  | "unsupported-fields"
  | "missing-key"
  | "missing-provider"
  | "unsupported-provider"
  | "missing-scope"
  | "non-canonical-scope"
  | "job-lifetime-unverifiable"
  | "job-expiry-semantics-unproven"
  | "scoped-use-unproven"
  | "owner-provenance-unverifiable"
  | "provider-metadata-unverifiable";

export interface CredentialEvaluation {
  readonly key: SecretKey | null;
  readonly credentialClass: CredentialClass | null;
  readonly verdict: CredentialVerdict;
  readonly exitCode: CredentialExitCode;
  readonly reasons: readonly CredentialReason[];
}

const EXIT_CODES: Readonly<Record<CredentialVerdict, CredentialExitCode>> = Object.freeze({
  satisfied: 0,
  violated: 1,
  indeterminate: 2,
});

function evaluation(
  key: SecretKey | null,
  credentialClass: CredentialClass | null,
  verdict: CredentialVerdict,
  reasons: readonly CredentialReason[],
): CredentialEvaluation {
  return Object.freeze({ key, credentialClass, verdict, exitCode: EXIT_CODES[verdict], reasons: Object.freeze([...reasons]) });
}

interface OwnDataRecord {
  readonly keys: readonly PropertyKey[];
  readonly values: Readonly<Record<string, unknown>>;
}

/**
 * Takes a getter-free snapshot of a plain record. Evidence is a data format,
 * not an object protocol: inherited fields, accessors, custom prototypes, and
 * proxy traps therefore cannot participate in a verdict.
 */
function readOwnDataRecord(value: unknown): OwnDataRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Object.prototype) return null;

  const keys = Reflect.ownKeys(value);
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return null;
    if (typeof key === "string") values[key] = descriptor.value;
  }
  return { keys, values };
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isKey(value: unknown): value is SecretKey {
  return isNonEmptyString(value) && value === value.trim();
}

const EPHEMERAL_GITHUB_ACTIONS_SCOPE_ORDER: readonly CredentialScope[] = [
  "contents:read",
  "id-token:write",
  "packages:read",
  "packages:write",
];

const MANUAL_GITHUB_SCOPE_ORDER: readonly CredentialScope[] = [
  "contents:read",
  "packages:read",
  "packages:write",
];

interface ScopeInspection {
  readonly reason: CredentialReason | null;
  readonly values: readonly CredentialScope[] | null;
}

function allowedScopeIndex(value: string, allowed: readonly CredentialScope[]): number {
  for (let index = 0; index < allowed.length; index += 1) {
    if (allowed[index] === value) return index;
  }
  return -1;
}

function inspectScope(value: unknown, credentialClass: CredentialClass): ScopeInspection {
  if (!Array.isArray(value)) return { reason: "missing-scope", values: null };
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    return { reason: "non-canonical-scope", values: null };
  }

  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) {
    return { reason: "non-canonical-scope", values: null };
  }
  const length = lengthDescriptor.value;
  if (length === 0) return { reason: "missing-scope", values: null };

  const allowed =
    credentialClass === "ephemeral-job"
      ? EPHEMERAL_GITHUB_ACTIONS_SCOPE_ORDER
      : MANUAL_GITHUB_SCOPE_ORDER;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 1 || length > allowed.length) {
    return { reason: "non-canonical-scope", values: null };
  }

  // The length is bounded before any length-proportional allocation or loop.
  const actualOwnKeys = Reflect.ownKeys(value);
  if (actualOwnKeys.length !== length + 1) {
    return { reason: "non-canonical-scope", values: null };
  }
  for (const key of actualOwnKeys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) {
      return { reason: "non-canonical-scope", values: null };
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
      return { reason: "non-canonical-scope", values: null };
    }
  }

  const values: CredentialScope[] = [];
  let previousAllowedIndex = -1;
  for (let index = 0; index < length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) {
      return { reason: "non-canonical-scope", values: null };
    }
    const entry = descriptor.value;
    if (typeof entry !== "string" || entry !== entry.trim()) {
      return { reason: "non-canonical-scope", values: null };
    }
    const allowedIndex = allowedScopeIndex(entry, allowed);
    if (allowedIndex <= previousAllowedIndex) {
      return { reason: "non-canonical-scope", values: null };
    }
    previousAllowedIndex = allowedIndex;
    values.push(entry as CredentialScope);
  }
  return { reason: null, values };
}

function hasOnlyFields(value: OwnDataRecord, fields: readonly string[]): boolean {
  const allowed = new Set(fields);
  return value.keys.every((field) => typeof field === "string" && allowed.has(field));
}

/**
 * Judges lifecycle evidence without reading, accepting, storing, or returning
 * a credential value. Unknown fields are indeterminate, so a token or value
 * smuggled through an untyped caller cannot be silently accepted or echoed.
 */
function evaluateCredentialUnchecked(evidence: unknown): CredentialEvaluation {
  const record = readOwnDataRecord(evidence);
  if (record === null) return evaluation(null, null, "indeterminate", ["invalid-evidence"]);

  const key = isKey(record.values.key) ? record.values.key : null;
  const credentialClass = record.values.credentialClass;
  if (credentialClass !== "ephemeral-job" && credentialClass !== "manually-rotatable") {
    return evaluation(key, null, "indeterminate", ["invalid-evidence"]);
  }

  if (
    credentialClass === "ephemeral-job" &&
    !hasOnlyFields(record, [
      "key",
      "credentialClass",
      "provider",
      "scope",
      "jobStartedAt",
      "jobEndedAt",
      "expiresAtJobEnd",
      "scopedUseObserved",
    ])
  ) {
    return evaluation(key, credentialClass, "indeterminate", ["unsupported-fields"]);
  }

  if (
    credentialClass === "manually-rotatable" &&
    !hasOnlyFields(record, [
      "key",
      "credentialClass",
      "provider",
      "scope",
      "repositorySecretUpdatedAt",
      "ownerProvenance",
    ])
  ) {
    return evaluation(key, credentialClass, "indeterminate", ["unsupported-fields"]);
  }

  if (!isKey(record.values.key)) {
    return evaluation(key, credentialClass, "violated", ["missing-key"]);
  }
  if (!isNonEmptyString(record.values.provider)) {
    return evaluation(key, credentialClass, "violated", ["missing-provider"]);
  }
  const scope = inspectScope(record.values.scope, credentialClass);
  if (scope.reason !== null) {
    return evaluation(key, credentialClass, "violated", [scope.reason]);
  }

  if (credentialClass === "ephemeral-job") {
    if (record.values.provider !== "github-actions") {
      return evaluation(key, credentialClass, "violated", ["unsupported-provider"]);
    }
    if (
      !isCanonicalUtcTimestamp(record.values.jobStartedAt) ||
      !isCanonicalUtcTimestamp(record.values.jobEndedAt) ||
      new Date(record.values.jobEndedAt) <= new Date(record.values.jobStartedAt)
    ) {
      return evaluation(key, credentialClass, "indeterminate", ["job-lifetime-unverifiable"]);
    }
    if (typeof record.values.expiresAtJobEnd !== "boolean") {
      return evaluation(key, credentialClass, "indeterminate", ["job-expiry-semantics-unproven"]);
    }
    if (!record.values.expiresAtJobEnd) {
      return evaluation(key, credentialClass, "violated", ["job-expiry-semantics-unproven"]);
    }
    if (record.values.scopedUseObserved !== true) {
      return evaluation(key, credentialClass, "indeterminate", ["scoped-use-unproven"]);
    }
    return evaluation(key, credentialClass, "satisfied", []);
  }

  if (record.values.provider !== "github") {
    return evaluation(key, credentialClass, "violated", ["unsupported-provider"]);
  }
  if (
    record.values.repositorySecretUpdatedAt !== undefined &&
    record.values.repositorySecretUpdatedAt !== null &&
    !isCanonicalUtcTimestamp(record.values.repositorySecretUpdatedAt)
  ) {
    return evaluation(key, credentialClass, "indeterminate", ["provider-metadata-unverifiable"]);
  }
  if (record.values.ownerProvenance === null) {
    return evaluation(key, credentialClass, "indeterminate", ["owner-provenance-unverifiable"]);
  }
  const ownerProvenance = readOwnDataRecord(record.values.ownerProvenance);
  if (ownerProvenance === null) {
    return evaluation(key, credentialClass, "indeterminate", ["owner-provenance-unverifiable"]);
  }
  if (!hasOnlyFields(ownerProvenance, ["source", "tokenCreatedAt", "observedAt"])) {
    return evaluation(key, credentialClass, "indeterminate", ["unsupported-fields"]);
  }
  if (
    ownerProvenance.values.source !== "owner-controlled" ||
    !isCanonicalUtcTimestamp(ownerProvenance.values.tokenCreatedAt) ||
    !isCanonicalUtcTimestamp(ownerProvenance.values.observedAt) ||
    new Date(ownerProvenance.values.tokenCreatedAt) > new Date(ownerProvenance.values.observedAt)
  ) {
    return evaluation(key, credentialClass, "indeterminate", ["owner-provenance-unverifiable"]);
  }
  return evaluation(key, credentialClass, "satisfied", []);
}

export function evaluateCredential(evidence: unknown): CredentialEvaluation {
  try {
    return evaluateCredentialUnchecked(evidence);
  } catch {
    return evaluation(null, null, "indeterminate", ["invalid-evidence"]);
  }
}

/** Frozen, value-free authoring helper for callers that already have typed evidence. */
export function defineCredentialEvidence(evidence: CredentialEvidence): CredentialEvidence {
  const evaluated = evaluateCredential(evidence);
  if (evaluated.verdict !== "satisfied") {
    throw new RangeError(`credential evidence is ${evaluated.verdict}: ${evaluated.reasons.join(", ")}`);
  }

  try {
    const record = readOwnDataRecord(evidence);
    if (record === null) throw new RangeError("credential evidence changed while it was being inspected");
    const credentialClass = record.values.credentialClass;
    const expectedFields =
      credentialClass === "ephemeral-job"
        ? ["key", "credentialClass", "provider", "scope", "jobStartedAt", "jobEndedAt", "expiresAtJobEnd", "scopedUseObserved"]
        : ["key", "credentialClass", "provider", "scope", "repositorySecretUpdatedAt", "ownerProvenance"];
    if (!hasOnlyFields(record, expectedFields)) {
      throw new RangeError("credential evidence changed while it was being inspected");
    }
    if (credentialClass !== "ephemeral-job" && credentialClass !== "manually-rotatable") {
      throw new RangeError("credential evidence changed while it was being inspected");
    }
    const scope = inspectScope(record.values.scope, credentialClass);
    if (scope.reason !== null || scope.values === null) {
      throw new RangeError("credential evidence changed while it was being inspected");
    }

    let snapshot: CredentialEvidence;
    if (credentialClass === "ephemeral-job") {
      snapshot = {
        key: record.values.key as SecretKey,
        credentialClass,
        provider: record.values.provider as "github-actions",
        scope: Object.freeze([...scope.values]),
        jobStartedAt: record.values.jobStartedAt as string,
        jobEndedAt: record.values.jobEndedAt as string,
        expiresAtJobEnd: record.values.expiresAtJobEnd as true,
        scopedUseObserved: record.values.scopedUseObserved as true,
      };
    } else {
      const ownerProvenance = readOwnDataRecord(record.values.ownerProvenance);
      if (ownerProvenance === null || !hasOnlyFields(ownerProvenance, ["source", "tokenCreatedAt", "observedAt"])) {
        throw new RangeError("credential evidence changed while it was being inspected");
      }
      snapshot = {
        key: record.values.key as SecretKey,
        credentialClass,
        provider: record.values.provider as "github",
        scope: Object.freeze([...scope.values]) as readonly Exclude<CredentialScope, "id-token:write">[],
        ...(record.keys.includes("repositorySecretUpdatedAt")
          ? { repositorySecretUpdatedAt: record.values.repositorySecretUpdatedAt as string | null | undefined }
          : {}),
        ownerProvenance: Object.freeze({
          source: ownerProvenance.values.source as "owner-controlled",
          tokenCreatedAt: ownerProvenance.values.tokenCreatedAt as string,
          observedAt: ownerProvenance.values.observedAt as string,
        }),
      };
    }
    const snapshotEvaluation = evaluateCredential(snapshot);
    if (snapshotEvaluation.verdict !== "satisfied") {
      throw new RangeError("credential evidence changed while it was being inspected");
    }
    return Object.freeze(snapshot);
  } catch (error) {
    if (error instanceof RangeError) throw error;
    throw new RangeError("credential evidence could not be inspected safely");
  }
}
