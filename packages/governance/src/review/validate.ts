import { REVIEW_EVIDENCE_VERSION } from "./types.js";
import type {
  ReviewCheckConclusion,
  ReviewDecision,
  ReviewEvidenceBundle,
  ReviewFinding,
  ReviewFindingRule,
  ReviewPolicy,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

const CHECK_CONCLUSIONS = new Set<ReviewCheckConclusion>([
  "success", "failure", "neutral", "skipped", "cancelled", "timed-out", "action-required", "pending", "unknown",
]);
const REVIEW_DECISIONS = new Set<ReviewDecision>([
  "approved", "changes-requested", "commented", "dismissed", "pending", "unknown",
]);
const POLICY_KEYS = new Set(["requiredChecks", "requireApproval"]);
const EVIDENCE_KEYS = new Set(["schemaVersion", "headSha", "paginationComplete", "checks", "reviews", "threads"]);
const CHECK_KEYS = new Set(["name", "conclusion", "headSha"]);
const REVIEW_KEYS = new Set(["id", "reviewerId", "submittedAt", "state", "headSha"]);
const THREAD_KEYS = new Set(["id", "isResolved", "headSha"]);
const SHA = /^[0-9a-f]{40}$/;
const RFC3339_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_ARRAY_ENTRIES = 10_000;

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => "value" in descriptor);
}

function ownData(value: UnknownRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function arrayEntry(value: unknown[], index: number): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function isDenseDataArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ENTRIES) return false;
  let entries = 0;
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === "length") continue;
    const index = Number(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= value.length || String(index) !== key || !descriptor || !("value" in descriptor)) return false;
    entries += 1;
  }
  return entries === value.length;
}

function finding(rule: ReviewFindingRule, path: string, message: string): ReviewFinding {
  return { rule, severity: "error", path, message };
}

function isSha(value: unknown): value is string {
  return typeof value === "string" && SHA.test(value);
}

function reviewTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = RFC3339_TIMESTAMP.exec(value);
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const calendar = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, second!));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month! - 1 || calendar.getUTCDate() !== day || calendar.getUTCHours() !== hour || calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function findUnknownFields(
  value: UnknownRecord,
  allowed: ReadonlySet<string>,
  rule: Extract<ReviewFindingRule, `${string}unknown-field`>,
  path: string,
  findings: ReviewFinding[],
): void {
  for (const key of Object.keys(value).sort()) {
    if (!allowed.has(key)) findings.push(finding(rule, `${path}.${key}`, "Unknown field."));
  }
}

/** Validates consumer-owned review requirements without performing I/O. */
export function validateReviewPolicy(value: unknown): ReviewFinding[] {
  try {
    if (!isRecord(value)) return [finding("policy-shape", "$policy", "A review policy must be an object.")];

    const findings: ReviewFinding[] = [];
    findUnknownFields(value, POLICY_KEYS, "policy-unknown-field", "$policy", findings);
    const requiredChecks = ownData(value, "requiredChecks");
    if (!isDenseDataArray(requiredChecks)) {
      findings.push(finding("required-checks-shape", "requiredChecks", "requiredChecks must be an array."));
    } else {
      const names = new Set<string>();
      for (let index = 0; index < requiredChecks.length; index += 1) {
        const name = arrayEntry(requiredChecks, index);
        const path = `requiredChecks[${index}]`;
        if (typeof name !== "string" || name.trim().length === 0) {
          findings.push(finding("required-check-name", path, "A required check name must be a non-empty string."));
        } else if (names.has(name)) {
          findings.push(finding("duplicate-required-check", path, `Duplicate required check name "${name}".`));
        } else {
          names.add(name);
        }
      }
    }
    if (typeof ownData(value, "requireApproval") !== "boolean") {
      findings.push(finding("require-approval", "requireApproval", "requireApproval must be a boolean."));
    }
    return findings;
  } catch {
    return [finding("policy-shape", "$policy", "A review policy must be safely readable.")];
  }
}

function readArray(value: UnknownRecord, key: "checks" | "reviews" | "threads", findings: ReviewFinding[]): unknown[] | undefined {
  const candidate = ownData(value, key);
  if (isDenseDataArray(candidate)) return candidate;
  const rule = key === "checks" ? "checks-shape" : key === "reviews" ? "reviews-shape" : "threads-shape";
  findings.push(finding(rule, key, `${key} must be an array.`));
  return undefined;
}

function validateChecks(entries: unknown[], headSha: string, findings: ReviewFinding[]): Map<string, ReviewCheckConclusion[]> {
  const byName = new Map<string, ReviewCheckConclusion[]>();
  for (let index = 0; index < entries.length; index += 1) {
    const path = `checks[${index}]`;
    const entry = arrayEntry(entries, index);
    if (!isRecord(entry)) {
      findings.push(finding("check-shape", path, "A check must be an object."));
      continue;
    }
    findUnknownFields(entry, CHECK_KEYS, "check-unknown-field", path, findings);
    const name = ownData(entry, "name");
    const conclusion = ownData(entry, "conclusion");
    const itemHeadSha = ownData(entry, "headSha");
    if (typeof name !== "string" || name.trim().length === 0) findings.push(finding("check-name", `${path}.name`, "A check name must be a non-empty string."));
    if (typeof conclusion !== "string" || !CHECK_CONCLUSIONS.has(conclusion as ReviewCheckConclusion)) {
      findings.push(finding("check-conclusion", `${path}.conclusion`, "A check conclusion must be a supported normalized value."));
    }
    if (!isSha(itemHeadSha)) {
      findings.push(finding("stale-evidence", `${path}.headSha`, "A check must identify the exact observed head commit."));
    } else if (itemHeadSha !== headSha) {
      findings.push(finding("stale-evidence", `${path}.headSha`, "Check evidence does not match the bundle head commit."));
    }
    if (typeof name === "string" && name.trim().length > 0 && typeof conclusion === "string" && CHECK_CONCLUSIONS.has(conclusion as ReviewCheckConclusion) && itemHeadSha === headSha) {
      const values = byName.get(name) ?? [];
      values.push(conclusion as ReviewCheckConclusion);
      byName.set(name, values);
    }
  }
  return byName;
}

function validateReviews(entries: unknown[], headSha: string, findings: ReviewFinding[]): { hasApproval: boolean; hasChangesRequested: boolean; hasAmbiguousDecision: boolean } {
  const latestByReviewer = new Map<string, { submittedAtMs: number; state: ReviewDecision; isAmbiguous: boolean }>();
  for (let index = 0; index < entries.length; index += 1) {
    const path = `reviews[${index}]`;
    const entry = arrayEntry(entries, index);
    if (!isRecord(entry)) {
      findings.push(finding("review-shape", path, "A review must be an object."));
      continue;
    }
    findUnknownFields(entry, REVIEW_KEYS, "review-unknown-field", path, findings);
    const id = ownData(entry, "id");
    const reviewerId = ownData(entry, "reviewerId");
    const submittedAt = ownData(entry, "submittedAt");
    const state = ownData(entry, "state");
    const itemHeadSha = ownData(entry, "headSha");
    const submittedAtMs = reviewTimestamp(submittedAt);
    if (typeof id !== "string" || id.trim().length === 0) findings.push(finding("review-id", `${path}.id`, "A review id must be a non-empty string."));
    if (typeof reviewerId !== "string" || reviewerId.trim().length === 0) findings.push(finding("reviewer-id", `${path}.reviewerId`, "A review must identify its reviewer."));
    if (submittedAtMs === undefined) findings.push(finding("review-submitted-at", `${path}.submittedAt`, "submittedAt must be an RFC 3339 timestamp with Z or an explicit offset."));
    if (typeof state !== "string" || !REVIEW_DECISIONS.has(state as ReviewDecision)) {
      findings.push(finding("review-state", `${path}.state`, "A review state must be a supported normalized value."));
    }
    if (!isSha(itemHeadSha)) {
      findings.push(finding("stale-evidence", `${path}.headSha`, "A review must identify the exact observed head commit."));
      continue;
    }
    if (itemHeadSha !== headSha) {
      findings.push(finding("stale-evidence", `${path}.headSha`, "Review evidence does not match the bundle head commit."));
      continue;
    }
    if (typeof reviewerId !== "string" || reviewerId.trim().length === 0 || submittedAtMs === undefined || typeof state !== "string" || !REVIEW_DECISIONS.has(state as ReviewDecision)) continue;
    if (state !== "approved" && state !== "changes-requested" && state !== "dismissed") continue;
    const previous = latestByReviewer.get(reviewerId);
    if (!previous || submittedAtMs > previous.submittedAtMs) {
      // A later decision is decisive even if an older timestamp was ambiguous.
      latestByReviewer.set(reviewerId, { submittedAtMs, state: state as ReviewDecision, isAmbiguous: false });
    } else if (submittedAtMs === previous.submittedAtMs && state !== previous.state) {
      latestByReviewer.set(reviewerId, { ...previous, isAmbiguous: true });
    }
  }
  const decisions = [...latestByReviewer.values()].map((review) => review.state);
  return {
    hasApproval: decisions.includes("approved"),
    hasChangesRequested: decisions.includes("changes-requested"),
    hasAmbiguousDecision: [...latestByReviewer.values()].some((review) => review.isAmbiguous),
  };
}

function validateThreads(entries: unknown[], headSha: string, findings: ReviewFinding[]): void {
  for (let index = 0; index < entries.length; index += 1) {
    const path = `threads[${index}]`;
    const entry = arrayEntry(entries, index);
    if (!isRecord(entry)) {
      findings.push(finding("thread-shape", path, "A review thread must be an object."));
      continue;
    }
    findUnknownFields(entry, THREAD_KEYS, "thread-unknown-field", path, findings);
    const id = ownData(entry, "id");
    const isResolved = ownData(entry, "isResolved");
    const itemHeadSha = ownData(entry, "headSha");
    if (typeof id !== "string" || id.trim().length === 0) findings.push(finding("thread-id", `${path}.id`, "A review thread id must be a non-empty string."));
    if (typeof isResolved !== "boolean") findings.push(finding("thread-resolution", `${path}.isResolved`, "isResolved must be a boolean."));
    if (!isSha(itemHeadSha)) {
      findings.push(finding("stale-evidence", `${path}.headSha`, "A review thread must identify the exact observed head commit."));
    } else if (itemHeadSha !== headSha) {
      findings.push(finding("stale-evidence", `${path}.headSha`, "Thread evidence does not match the bundle head commit."));
    } else if (isResolved === false) {
      findings.push(finding("unresolved-thread", path, "A current-head review thread remains unresolved."));
    }
  }
}

/**
 * Validates a review evidence snapshot against a consumer-owned policy.
 * The function is deterministic, performs no I/O, and fails closed when a
 * collection is incomplete or an item was observed for another head.
 */
export function validateReviewEvidence(value: unknown, policy: unknown): ReviewFinding[] {
  const findings = validateReviewPolicy(policy);
  try {
    if (!isRecord(value)) return [...findings, finding("evidence-shape", "$", "Review evidence must be an object.")];
    findUnknownFields(value, EVIDENCE_KEYS, "evidence-unknown-field", "$", findings);
    const schemaVersion = ownData(value, "schemaVersion");
    const headSha = ownData(value, "headSha");
    const paginationComplete = ownData(value, "paginationComplete");
    if (schemaVersion !== REVIEW_EVIDENCE_VERSION) findings.push(finding("schema-version", "schemaVersion", `schemaVersion must be ${REVIEW_EVIDENCE_VERSION}.`));
    if (!isSha(headSha)) findings.push(finding("head-sha", "headSha", "headSha must be exactly 40 lowercase hexadecimal characters."));
    if (paginationComplete !== true) findings.push(finding("pagination-incomplete", "paginationComplete", "Evidence must include every page before it can pass review."));

    const checks = readArray(value, "checks", findings);
    const reviews = readArray(value, "reviews", findings);
    const threads = readArray(value, "threads", findings);
    if (!isSha(headSha)) return findings;

    const checkStates = checks ? validateChecks(checks, headSha, findings) : new Map<string, ReviewCheckConclusion[]>();
    const reviewState = reviews ? validateReviews(reviews, headSha, findings) : { hasApproval: false, hasChangesRequested: false, hasAmbiguousDecision: false };
    if (threads) validateThreads(threads, headSha, findings);

    const policyRequiredChecks = isRecord(policy) ? ownData(policy, "requiredChecks") : undefined;
    if (isDenseDataArray(policyRequiredChecks)) {
      for (let index = 0; index < policyRequiredChecks.length; index += 1) {
        const name = arrayEntry(policyRequiredChecks, index);
        if (typeof name !== "string" || name.trim().length === 0) continue;
        const states = checkStates.get(name) ?? [];
        if (states.length === 0) findings.push(finding("missing-required-check", `requiredChecks[${index}]`, `Required check "${name}" has no current-head evidence.`));
        else if (states.some((state) => state !== "success")) findings.push(finding("required-check-failed", `requiredChecks[${index}]`, `Required check "${name}" did not report success.`));
      }
      if (isRecord(policy) && ownData(policy, "requireApproval") === true && !reviewState.hasApproval) findings.push(finding("approval-missing", "reviews", "A current-head approval is required."));
    }
    if (reviewState.hasChangesRequested) findings.push(finding("changes-requested", "reviews", "A current-head review requested changes."));
    if (reviewState.hasAmbiguousDecision) findings.push(finding("review-decision-ambiguous", "reviews", "Conflicting decisive reviews share a timestamp and cannot be ordered safely."));
    return findings;
  } catch {
    return [...findings, finding("evidence-shape", "$", "Review evidence must be safely readable.")];
  }
}

/** Narrows valid normalized data after validation for consumers that need it. */
export function isReviewEvidenceBundle(value: unknown): value is ReviewEvidenceBundle {
  return validateReviewEvidence(value, { requiredChecks: [], requireApproval: false })
    .every((entry) => entry.rule === "changes-requested" || entry.rule === "unresolved-thread" || entry.rule === "review-decision-ambiguous");
}

/** Narrows valid consumer-owned policy data without choosing any policy values. */
export function isReviewPolicy(value: unknown): value is ReviewPolicy {
  return validateReviewPolicy(value).length === 0;
}
