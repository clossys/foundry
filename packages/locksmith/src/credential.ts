import type { SecretKey } from "./types.js";

/** The two lifecycle classes Locksmith can judge without seeing a credential value. */
export type CredentialClass = "ephemeral-job" | "manually-rotatable";
export type CredentialProvider = "github-actions" | "github";

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
  readonly scope: readonly string[];
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
  readonly scope: readonly string[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function isScope(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isNonEmptyString)) return false;
  return value.every((entry, index) => entry === entry.trim() && value.indexOf(entry) === index);
}

function hasOnlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const allowed = new Set(fields);
  return Object.keys(value).every((field) => allowed.has(field));
}

function keyOf(value: unknown): SecretKey | null {
  return isRecord(value) && isKey(value.key) ? value.key : null;
}

/**
 * Judges lifecycle evidence without reading, accepting, storing, or returning
 * a credential value. Unknown fields are indeterminate, so a token or value
 * smuggled through an untyped caller cannot be silently accepted or echoed.
 */
export function evaluateCredential(evidence: unknown): CredentialEvaluation {
  const key = keyOf(evidence);
  if (!isRecord(evidence)) return evaluation(null, null, "indeterminate", ["invalid-evidence"]);

  const credentialClass = evidence.credentialClass;
  if (credentialClass !== "ephemeral-job" && credentialClass !== "manually-rotatable") {
    return evaluation(key, null, "indeterminate", ["invalid-evidence"]);
  }

  if (
    credentialClass === "ephemeral-job" &&
    !hasOnlyFields(evidence, [
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
    !hasOnlyFields(evidence, [
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

  if (!isKey(evidence.key)) {
    return evaluation(key, credentialClass, "violated", ["missing-key"]);
  }
  if (!isNonEmptyString(evidence.provider)) {
    return evaluation(key, credentialClass, "violated", ["missing-provider"]);
  }
  if (!isScope(evidence.scope)) {
    const scope = evidence.scope;
    return evaluation(
      key,
      credentialClass,
      "violated",
      Array.isArray(scope) && scope.some((entry) => typeof entry === "string" && entry !== entry.trim())
        ? ["non-canonical-scope"]
        : Array.isArray(scope) && new Set(scope).size !== scope.length
          ? ["non-canonical-scope"]
          : ["missing-scope"],
    );
  }

  if (credentialClass === "ephemeral-job") {
    if (evidence.provider !== "github-actions") {
      return evaluation(key, credentialClass, "violated", ["unsupported-provider"]);
    }
    if (
      !isCanonicalUtcTimestamp(evidence.jobStartedAt) ||
      !isCanonicalUtcTimestamp(evidence.jobEndedAt) ||
      new Date(evidence.jobEndedAt) < new Date(evidence.jobStartedAt)
    ) {
      return evaluation(key, credentialClass, "indeterminate", ["job-lifetime-unverifiable"]);
    }
    if (evidence.expiresAtJobEnd !== true) {
      return evaluation(key, credentialClass, "violated", ["job-expiry-semantics-unproven"]);
    }
    if (evidence.scopedUseObserved !== true) {
      return evaluation(key, credentialClass, "indeterminate", ["scoped-use-unproven"]);
    }
    return evaluation(key, credentialClass, "satisfied", []);
  }

  if (evidence.provider !== "github") {
    return evaluation(key, credentialClass, "violated", ["unsupported-provider"]);
  }
  if (
    evidence.repositorySecretUpdatedAt !== undefined &&
    evidence.repositorySecretUpdatedAt !== null &&
    !isCanonicalUtcTimestamp(evidence.repositorySecretUpdatedAt)
  ) {
    return evaluation(key, credentialClass, "indeterminate", ["provider-metadata-unverifiable"]);
  }
  if (evidence.ownerProvenance === null || !isRecord(evidence.ownerProvenance)) {
    return evaluation(key, credentialClass, "indeterminate", ["owner-provenance-unverifiable"]);
  }
  if (!hasOnlyFields(evidence.ownerProvenance, ["source", "tokenCreatedAt", "observedAt"])) {
    return evaluation(key, credentialClass, "indeterminate", ["unsupported-fields"]);
  }
  if (
    evidence.ownerProvenance.source !== "owner-controlled" ||
    !isCanonicalUtcTimestamp(evidence.ownerProvenance.tokenCreatedAt) ||
    !isCanonicalUtcTimestamp(evidence.ownerProvenance.observedAt) ||
    new Date(evidence.ownerProvenance.tokenCreatedAt) > new Date(evidence.ownerProvenance.observedAt)
  ) {
    return evaluation(key, credentialClass, "indeterminate", ["owner-provenance-unverifiable"]);
  }
  return evaluation(key, credentialClass, "satisfied", []);
}

/** Frozen, value-free authoring helper for callers that already have typed evidence. */
export function defineCredentialEvidence(evidence: CredentialEvidence): CredentialEvidence {
  const evaluated = evaluateCredential(evidence);
  if (evaluated.verdict !== "satisfied") {
    throw new RangeError(`credential evidence is ${evaluated.verdict}: ${evaluated.reasons.join(", ")}`);
  }
  return Object.freeze({
    ...evidence,
    scope: Object.freeze([...evidence.scope].sort()),
    ...(evidence.credentialClass === "manually-rotatable" && evidence.ownerProvenance !== null
      ? { ownerProvenance: Object.freeze({ ...evidence.ownerProvenance }) }
      : {}),
  });
}
