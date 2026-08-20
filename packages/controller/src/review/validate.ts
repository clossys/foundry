import { REVIEW_EVIDENCE_VERSION } from "./types.js";
import type {
  ReviewCheckConclusion,
  ReviewDecision,
  ReviewDepth,
  ReviewEvidenceBundle,
  ReviewFinding,
  ReviewFindingRule,
  ReviewPolicy,
  ReviewPolicyAdoptionState,
  ReviewPolicyCoverageState,
  ReviewPolicyDecisionUse,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

const CHECK_CONCLUSIONS = new Set<ReviewCheckConclusion>([
  "success", "failure", "neutral", "skipped", "cancelled", "timed-out", "action-required", "pending", "unknown",
]);
const REVIEW_DECISIONS = new Set<ReviewDecision>([
  "approved", "changes-requested", "commented", "dismissed", "pending", "unknown",
]);
const REVIEW_DEPTHS = new Set<ReviewDepth>(["primary", "secondary", "secondary-incomplete"]);
const DECISION_USES = new Set<ReviewPolicyDecisionUse>(["advisory", "authoritative"]);
// Deliberately two disjoint Sets with no shared code path between them (see
// ReviewPolicyCoverageState's doc comment): adoption and coverage must never
// be derivable from one another, and keeping their vocabularies structurally
// separate -- rather than, say, one Set with a shared "pass" value -- is part
// of how that stays true rather than merely documented.
const ADOPTION_STATES = new Set<ReviewPolicyAdoptionState>(["adopted", "not-adopted", "assessment-pending"]);
const COVERAGE_STATES = new Set<ReviewPolicyCoverageState>(["verified", "not-verified", "assessment-pending"]);
const POLICY_KEYS = new Set(["requiredChecks", "requireApproval", "requireSecondaryReview", "decisionUse"]);
const EVIDENCE_KEYS = new Set(["schemaVersion", "headSha", "baseSha", "patchId", "paginationComplete", "checks", "reviews", "threads"]);
const CHECK_KEYS = new Set(["name", "conclusion", "headSha", "completedAt"]);
const REVIEW_KEYS = new Set(["id", "reviewerId", "instanceId", "provider", "submittedAt", "state", "depth", "headSha"]);
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

// Shared by ReviewRecord.submittedAt and ReviewCheck.completedAt -- both are
// RFC 3339 instants this package orders records/runs by, so both parse
// through the same strict rule rather than two subtly different regexes.
function parseRfc3339Timestamp(value: unknown): number | undefined {
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
    const requireApproval = ownData(value, "requireApproval");
    if (typeof requireApproval !== "boolean") {
      findings.push(finding("require-approval", "requireApproval", "requireApproval must be a boolean."));
    }
    const requireSecondaryReview = ownData(value, "requireSecondaryReview");
    if (typeof requireSecondaryReview !== "boolean") {
      findings.push(finding("require-secondary-review", "requireSecondaryReview", "requireSecondaryReview must be a boolean."));
    }
    const decisionUse = ownData(value, "decisionUse");
    if (decisionUse !== "advisory" && decisionUse !== "authoritative") {
      findings.push(finding("decision-use", "decisionUse", 'decisionUse must be exactly "advisory" or "authoritative".'));
    } else if (decisionUse === "advisory" && requireApproval === true) {
      // Rejected here, inside policy validation, before any evidence is read:
      // an advisory model can never let an approval grant clearance, so this
      // combination is self-contradictory regardless of what evidence exists.
      findings.push(finding("advisory-approval-conflict", "requireApproval", 'requireApproval must be false when decisionUse is "advisory"; an advisory review model can never grant merge clearance.'));
    } else if (decisionUse === "advisory" && requireSecondaryReview === true) {
      // Same self-contradiction, one level deeper: a secondary review can
      // never grant clearance under an advisory model either. Reported only
      // when the requireApproval conflict above did not already fire, for
      // the same reason validateReviewEvidence never piles "approval-missing"
      // on top of an already-conflicted policy -- a second finding about a
      // policy that is already invalid is noise, not new information.
      findings.push(finding("advisory-secondary-conflict", "requireSecondaryReview", 'requireSecondaryReview must be false when decisionUse is "advisory"; an advisory review model can never grant merge clearance, primary or secondary.'));
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

/**
 * One current-head, otherwise-well-formed run of a named check.
 * `completedAtMs` is `undefined` exactly when the entry carried no
 * `completedAt` at all (a legitimately still-running check -- see
 * `ReviewCheck`'s own doc comment); it is never `undefined` because a
 * supplied value failed to parse -- that case is rejected as a
 * `"check-completed-at"` finding and the whole entry is excluded from
 * `validateChecks`'s returned map instead, the same way an invalid `name` or
 * `conclusion` already excludes it.
 */
interface CheckObservation {
  readonly conclusion: ReviewCheckConclusion;
  readonly completedAtMs: number | undefined;
}

function validateChecks(entries: unknown[], headSha: string, findings: ReviewFinding[]): Map<string, CheckObservation[]> {
  const byName = new Map<string, CheckObservation[]>();
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
    const rawCompletedAt = ownData(entry, "completedAt");
    if (typeof name !== "string" || name.trim().length === 0) findings.push(finding("check-name", `${path}.name`, "A check name must be a non-empty string."));
    if (typeof conclusion !== "string" || !CHECK_CONCLUSIONS.has(conclusion as ReviewCheckConclusion)) {
      findings.push(finding("check-conclusion", `${path}.conclusion`, "A check conclusion must be a supported normalized value."));
    }
    if (!isSha(itemHeadSha)) {
      findings.push(finding("stale-evidence", `${path}.headSha`, "A check must identify the exact observed head commit."));
    } else if (itemHeadSha !== headSha) {
      findings.push(finding("stale-evidence", `${path}.headSha`, "Check evidence does not match the bundle head commit."));
    }
    // completedAt is optional -- a check that has not finished yet
    // legitimately has none (see ReviewCheck's own doc comment) -- but when
    // the caller DOES supply a value it must be a real RFC 3339 instant, the
    // same strict rule submittedAt already follows below. An unparseable
    // value is never silently treated the same as an absent one: that would
    // let a caller-side bug (a non-timestamp string, a bare epoch number, a
    // truncated value) quietly fall back to "no timestamp" instead of being
    // reported, which would then silently widen how often recency reads as
    // indeterminate for reasons the caller never sees.
    let completedAtMs: number | undefined;
    let completedAtValid = true;
    if (rawCompletedAt !== undefined) {
      completedAtMs = parseRfc3339Timestamp(rawCompletedAt);
      if (completedAtMs === undefined) {
        completedAtValid = false;
        findings.push(finding("check-completed-at", `${path}.completedAt`, "completedAt, when present, must be an RFC 3339 timestamp with Z or an explicit offset."));
      }
    }
    if (
      typeof name === "string" && name.trim().length > 0
      && typeof conclusion === "string" && CHECK_CONCLUSIONS.has(conclusion as ReviewCheckConclusion)
      && itemHeadSha === headSha
      && completedAtValid
    ) {
      const observations = byName.get(name) ?? [];
      observations.push({ conclusion: conclusion as ReviewCheckConclusion, completedAtMs });
      byName.set(name, observations);
    }
  }
  return byName;
}

/** What grading the latest observed current-head run of one check concluded. */
type CheckGrade =
  | { readonly kind: "graded"; readonly conclusion: ReviewCheckConclusion }
  | { readonly kind: "indeterminate"; readonly reason: string };

/**
 * Picks the run that actually counts out of every current-head observation
 * collected for one check name -- this is the fix for the incident this
 * module exists to close (see ReviewFindingRule's
 * `"required-check-indeterminate"` doc comment): the FIRST observation for a
 * name is never automatically "the" one graded, and neither is the last; a
 * name with only one observation trivially IS that one observation, but a
 * name with several is resolved strictly by `completedAt`, never by array
 * position.
 *
 * When recency cannot be established without guessing -- an observation with
 * no usable `completedAt` in the mix, or more than one observation tied for
 * the latest `completedAt` that disagree on `conclusion` -- this reports
 * `indeterminate` rather than picking a winner. Never invents an order.
 */
function gradeCheckObservations(observations: readonly CheckObservation[]): CheckGrade {
  if (observations.length === 1) return { kind: "graded", conclusion: observations[0]!.conclusion };
  if (observations.some((observation) => observation.completedAtMs === undefined)) {
    return {
      kind: "indeterminate",
      reason: `has ${observations.length} current-head runs and at least one carries no completion timestamp, so the most recent cannot be identified safely`,
    };
  }
  const latestMs = Math.max(...observations.map((observation) => observation.completedAtMs!));
  const atLatest = observations.filter((observation) => observation.completedAtMs === latestMs);
  const distinctConclusions = new Set(atLatest.map((observation) => observation.conclusion));
  if (distinctConclusions.size > 1) {
    return {
      kind: "indeterminate",
      reason: `has ${atLatest.length} runs tied for the most recent completion timestamp that disagree on conclusion, so the most recent result cannot be determined safely`,
    };
  }
  return { kind: "graded", conclusion: atLatest[0]!.conclusion };
}

interface ReviewValidationResult {
  readonly hasApproval: boolean;
  readonly hasChangesRequested: boolean;
  readonly hasAmbiguousDecision: boolean;
  readonly hasSecondaryApproval: boolean;
}

function validateReviews(entries: unknown[], headSha: string, findings: ReviewFinding[]): ReviewValidationResult {
  // Keyed by instanceId, not reviewerId. reviewerId remains purely
  // descriptive (see ReviewRecord's own doc comment): a consuming account
  // can legitimately emit the same reviewerId, even the same login, for
  // every independent audit it ever runs, so grouping decisive state by
  // reviewerId would silently let two genuinely independent review sessions
  // collapse into one via ordinary latest-wins. Grouping by instanceId keeps
  // "a reviewer revising their own decision within one session" (multiple
  // records, one instanceId, latest submittedAt wins) distinct from "two
  // independent sessions" (different instanceId, each contributes its own
  // effective decision, neither ever shadows the other).
  const latestByInstance = new Map<string, { submittedAtMs: number; state: ReviewDecision; depth: ReviewDepth; isAmbiguous: boolean }>();
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
    const instanceId = ownData(entry, "instanceId");
    const provider = ownData(entry, "provider");
    const submittedAt = ownData(entry, "submittedAt");
    const state = ownData(entry, "state");
    const depth = ownData(entry, "depth");
    const itemHeadSha = ownData(entry, "headSha");
    const submittedAtMs = parseRfc3339Timestamp(submittedAt);
    if (typeof id !== "string" || id.trim().length === 0) findings.push(finding("review-id", `${path}.id`, "A review id must be a non-empty string."));
    if (typeof reviewerId !== "string" || reviewerId.trim().length === 0) findings.push(finding("reviewer-id", `${path}.reviewerId`, "A review must identify its reviewer."));
    // Required rather than defaulted: a silently-invented or reviewerId-
    // derived instance id would let two independent review sessions be
    // mistaken for one, exactly the defect this field exists to close (see
    // ReviewRecord's own doc comment).
    if (typeof instanceId !== "string" || instanceId.trim().length === 0) findings.push(finding("review-instance-id", `${path}.instanceId`, "A review must identify its own review session."));
    // Required rather than defaulted to "" or "unknown": a review silently
    // normalized to an empty provider would make an unknown-provider record
    // indistinguishable from a caller that simply forgot to declare one, the
    // same bad failure direction decisionUse's own no-default rule rejects.
    if (typeof provider !== "string" || provider.trim().length === 0) findings.push(finding("review-provider", `${path}.provider`, "A review must identify which analyzer produced it."));
    if (submittedAtMs === undefined) findings.push(finding("review-submitted-at", `${path}.submittedAt`, "submittedAt must be an RFC 3339 timestamp with Z or an explicit offset."));
    if (typeof state !== "string" || !REVIEW_DECISIONS.has(state as ReviewDecision)) {
      findings.push(finding("review-state", `${path}.state`, "A review state must be a supported normalized value."));
    }
    if (typeof depth !== "string" || !REVIEW_DEPTHS.has(depth as ReviewDepth)) {
      findings.push(finding("review-depth", `${path}.depth`, "A review depth must be a supported normalized value."));
    }
    if (!isSha(itemHeadSha)) {
      findings.push(finding("stale-evidence", `${path}.headSha`, "A review must identify the exact observed head commit."));
      continue;
    }
    if (itemHeadSha !== headSha) {
      findings.push(finding("stale-evidence", `${path}.headSha`, "Review evidence does not match the bundle head commit."));
      continue;
    }
    if (
      typeof reviewerId !== "string" || reviewerId.trim().length === 0
      || typeof instanceId !== "string" || instanceId.trim().length === 0
      || submittedAtMs === undefined
      || typeof state !== "string" || !REVIEW_DECISIONS.has(state as ReviewDecision)
      || typeof depth !== "string" || !REVIEW_DEPTHS.has(depth as ReviewDepth)
    ) continue;
    if (state !== "approved" && state !== "changes-requested" && state !== "dismissed") continue;
    const previous = latestByInstance.get(instanceId);
    if (!previous || submittedAtMs > previous.submittedAtMs) {
      // A later decision is decisive even if an older timestamp was ambiguous.
      latestByInstance.set(instanceId, { submittedAtMs, state: state as ReviewDecision, depth: depth as ReviewDepth, isAmbiguous: false });
    } else if (submittedAtMs === previous.submittedAtMs && state !== previous.state) {
      latestByInstance.set(instanceId, { ...previous, isAmbiguous: true });
    }
  }
  const decisions = [...latestByInstance.values()];
  return {
    hasApproval: decisions.some((review) => review.state === "approved"),
    hasChangesRequested: decisions.some((review) => review.state === "changes-requested"),
    hasAmbiguousDecision: decisions.some((review) => review.isAmbiguous),
    // A satisfied secondary is now a stated, validated fact about a specific
    // instance's own effective decision, not a population count over records
    // indistinguishable by construction: only an instance whose LATEST
    // decisive record is both depth "secondary" and state "approved" counts.
    // A "secondary-incomplete" record, whatever its state, never does (see
    // ReviewDepth's own doc comment).
    hasSecondaryApproval: decisions.some((review) => review.state === "approved" && review.depth === "secondary"),
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
    const baseSha = ownData(value, "baseSha");
    const patchId = ownData(value, "patchId");
    const paginationComplete = ownData(value, "paginationComplete");
    if (schemaVersion !== REVIEW_EVIDENCE_VERSION) {
      // Every prior schema version is rejected outright, never coerced or
      // silently accepted: version 1 has no base-commit binding at all, and
      // version 2 has no review depth or review-instance identity, so there
      // is no safe way to treat either as a version-3 bundle with those
      // fields merely unknown.
      findings.push(finding("schema-version", "schemaVersion", `schemaVersion must be ${REVIEW_EVIDENCE_VERSION} (received ${JSON.stringify(schemaVersion)}). Version 1 evidence has no base-commit binding, and version 2 evidence has no review depth or review-instance identity; neither is upgraded.`));
    }
    if (!isSha(headSha)) findings.push(finding("head-sha", "headSha", "headSha must be exactly 40 lowercase hexadecimal characters."));
    if (!isSha(baseSha)) findings.push(finding("base-sha", "baseSha", "baseSha must be exactly 40 lowercase hexadecimal characters."));
    // patchId is optional (see ReviewEvidenceBundle's own doc comment for
    // why its absence is safe), but when present it must be a real, non-empty
    // opaque identifier -- not coerced from, say, a number, and not silently
    // accepted as an empty string standing in for "none". It is deliberately
    // NOT constrained to headSha/baseSha's 40-lowercase-hex shape: git's
    // patch-id is only the established analogue, not a mandated algorithm,
    // and assuming its exact output shape would silently assume every caller
    // uses that one scheme.
    if (patchId !== undefined && (typeof patchId !== "string" || patchId.length === 0)) {
      findings.push(finding("patch-id", "patchId", "patchId, when present, must be a non-empty string."));
    }
    if (paginationComplete !== true) findings.push(finding("pagination-incomplete", "paginationComplete", "Evidence must include every page before it can pass review."));

    const checks = readArray(value, "checks", findings);
    const reviews = readArray(value, "reviews", findings);
    const threads = readArray(value, "threads", findings);
    if (!isSha(headSha)) return findings;

    const checkStates = checks ? validateChecks(checks, headSha, findings) : new Map<string, CheckObservation[]>();
    const reviewState: ReviewValidationResult = reviews
      ? validateReviews(reviews, headSha, findings)
      : { hasApproval: false, hasChangesRequested: false, hasAmbiguousDecision: false, hasSecondaryApproval: false };
    if (threads) validateThreads(threads, headSha, findings);

    const requireApproval = isRecord(policy) ? ownData(policy, "requireApproval") : undefined;
    const requireSecondaryReview = isRecord(policy) ? ownData(policy, "requireSecondaryReview") : undefined;
    const decisionUse = isRecord(policy) ? ownData(policy, "decisionUse") : undefined;
    // The advisory+requireApproval combination is already rejected by
    // validateReviewPolicy above (rule "advisory-approval-conflict"). Don't
    // also pile an "approval-missing" finding on top of that: the policy is
    // already invalid, so a second finding about the missing approval it
    // could never have honored would only be noise on top of the real error.
    const advisoryApprovalConflict = decisionUse === "advisory" && requireApproval === true;
    // Same reasoning, for the secondary-review conflict rule.
    const advisorySecondaryConflict = decisionUse === "advisory" && requireSecondaryReview === true;

    const policyRequiredChecks = isRecord(policy) ? ownData(policy, "requiredChecks") : undefined;
    if (isDenseDataArray(policyRequiredChecks)) {
      for (let index = 0; index < policyRequiredChecks.length; index += 1) {
        const name = arrayEntry(policyRequiredChecks, index);
        if (typeof name !== "string" || name.trim().length === 0) continue;
        const path = `requiredChecks[${index}]`;
        // Pagination first, unconditionally: an unread page could be hiding
        // a NEWER run of this exact name than anything observed so far, so
        // whatever this check's own observations already show -- including a
        // clean "success" -- cannot be trusted as the latest run while the
        // collection is known incomplete. This is checked before consulting
        // `checkStates` at all, so an incomplete collection never lets an
        // already-seen run stand in for "no newer run exists" -- see
        // ReviewFindingRule's "required-check-indeterminate" doc comment.
        if (paginationComplete !== true) {
          findings.push(finding("required-check-indeterminate", path, `Required check "${name}" cannot be evaluated: the check collection has not been fully paginated, so a more recent run for this name may exist on an unread page.`));
          continue;
        }
        const observations = checkStates.get(name);
        if (!observations || observations.length === 0) {
          findings.push(finding("missing-required-check", path, `Required check "${name}" has no current-head evidence.`));
          continue;
        }
        // Grade the run that actually is the most recent one -- never the
        // first (or last) entry encountered for this name. This is the fix
        // for the incident this module exists to close: a name repeated
        // across several runs (every attempt for the head commit, not one
        // current value per name) used to be graded by simple array
        // membership, so a later successful re-run could never clear an
        // earlier failure the same collection still carried alongside it.
        const grade = gradeCheckObservations(observations);
        if (grade.kind === "indeterminate") {
          findings.push(finding("required-check-indeterminate", path, `Required check "${name}" ${grade.reason}.`));
        } else if (grade.conclusion !== "success") {
          findings.push(finding("required-check-failed", path, `Required check "${name}" did not report success.`));
        }
      }
      if (!advisoryApprovalConflict && requireApproval === true && !reviewState.hasApproval) findings.push(finding("approval-missing", "reviews", "A current-head approval is required."));
      // A record whose policy demands a secondary review but whose depth
      // does not show one satisfied must not validate as clean: only a
      // "secondary"-depth record reaching a clean decisive state counts (see
      // validateReviews' own hasSecondaryApproval comment). A
      // "secondary-incomplete" record, however decisive its own state, never
      // silently satisfies this on its own.
      if (!advisorySecondaryConflict && requireSecondaryReview === true && !reviewState.hasSecondaryApproval) findings.push(finding("secondary-review-missing", "reviews", "A current-head secondary independent review is required."));
    }
    // changes-requested and unresolved-thread are deliberately unconditional:
    // they fire regardless of requireApproval, decisionUse, or requiredChecks
    // -- including when the caller's policy requires nothing at all. This is
    // the one authority a policy can never opt out of. A live objection (a
    // current-head changes-requested review, or an unresolved thread) is
    // always reported, in both "advisory" and "authoritative" models alike,
    // because a policy that could silently waive it would let evidence with
    // an unaddressed objection read as clean. isReviewEvidenceBundle below
    // narrows past exactly these two rules plus review-decision-ambiguous --
    // deliberately, since those three describe a decision OUTCOME, not a
    // defect in the evidence's SHAPE, and a consumer narrowing to the type
    // still needs to inspect findings for a real decision.
    if (reviewState.hasChangesRequested) findings.push(finding("changes-requested", "reviews", "A current-head review requested changes."));
    if (reviewState.hasAmbiguousDecision) findings.push(finding("review-decision-ambiguous", "reviews", "Conflicting decisive reviews share a timestamp and cannot be ordered safely."));
    return findings;
  } catch {
    return [...findings, finding("evidence-shape", "$", "Review evidence must be safely readable.")];
  }
}

/**
 * Narrows valid normalized data after validation for consumers that need it.
 * This is shape narrowing, not a decision outcome: it deliberately ignores
 * "changes-requested", "unresolved-thread", and "review-decision-ambiguous"
 * findings, so a bundle can narrow to `ReviewEvidenceBundle` while still
 * carrying a live objection a caller must separately inspect
 * `validateReviewEvidence`'s findings to see. Do not change this — consumers
 * may depend on narrowing succeeding independently of decision outcome.
 */
export function isReviewEvidenceBundle(value: unknown): value is ReviewEvidenceBundle {
  return validateReviewEvidence(value, { requiredChecks: [], requireApproval: false, requireSecondaryReview: false, decisionUse: "authoritative" })
    .every((entry) => entry.rule === "changes-requested" || entry.rule === "unresolved-thread" || entry.rule === "review-decision-ambiguous");
}

/** Narrows valid consumer-owned policy data without choosing any policy values. */
export function isReviewPolicy(value: unknown): value is ReviewPolicy {
  return validateReviewPolicy(value).length === 0;
}

/**
 * Whether `evidence` remains usable after only its base advanced -- not a
 * fresh audit, but not stale either. True only when `evidence.patchId` and
 * `currentPatchId` are both non-empty strings and equal: the change this
 * evidence was gathered against is byte-identical, by patch identity, to the
 * change at `currentPatchId`, so whatever was reviewed still applies
 * regardless of which base commit now sits underneath the head. This package
 * never computes a patch id and never reads a diff to decide this (see
 * `ReviewEvidenceBundle`'s own doc comment) -- `currentPatchId` is taken as
 * `unknown`, exactly as caller-supplied as `evidence.patchId` was, and
 * validated defensively rather than assumed to already be a well-formed
 * string.
 *
 * This is a distinct, separately exported predicate, not a
 * `validateReviewEvidence` finding rule and not an added parameter to that
 * function, because it answers a different question than that function
 * does. `validateReviewEvidence` validates one bundle's own internal shape
 * and its fit against a policy; every `headSha` comparison inside it is a
 * WITHIN-bundle consistency check (does this check/review/thread match this
 * bundle's own `headSha`), never a comparison against some other, live head.
 * Whether `evidence.headSha` still matches a pull request's real current
 * head is already an entirely caller-side comparison that happens before
 * evidence would ever be handed to `validateReviewEvidence` again.
 * Revalidation is the same shape of external, caller-side comparison, so it
 * belongs beside that comparison, not folded into shape/policy validation.
 * It also never mutates or re-derives `evidence`: whether stale-but-
 * revalidatable evidence is actually treated as current for a merge is a
 * policy decision this package does not make -- this predicate supplies the
 * fact only, never the consequence.
 */
export function isRevalidatableReviewEvidence(evidence: ReviewEvidenceBundle, currentPatchId: unknown): boolean {
  return typeof evidence.patchId === "string" && evidence.patchId.length > 0
    && typeof currentPatchId === "string" && currentPatchId.length > 0
    && evidence.patchId === currentPatchId;
}

/**
 * Narrows a candidate adoption-state value. Accepts only `"adopted"`,
 * `"not-adopted"`, or `"assessment-pending"` -- never any
 * `ReviewPolicyCoverageState` value, so an adoption value alone can never
 * read as a valid coverage value. The per-repository value itself is each
 * consuming account's own data; this package supplies only the vocabulary
 * and this guard.
 */
export function isReviewPolicyAdoptionState(value: unknown): value is ReviewPolicyAdoptionState {
  return typeof value === "string" && ADOPTION_STATES.has(value as ReviewPolicyAdoptionState);
}

/**
 * Narrows a candidate coverage-state value. Accepts only `"verified"`,
 * `"not-verified"`, or `"assessment-pending"` -- never any
 * `ReviewPolicyAdoptionState` value, so a coverage requirement can never be
 * satisfied merely by supplying an adoption value. The per-repository value
 * itself is each consuming account's own data; this package supplies only
 * the vocabulary and this guard.
 */
export function isReviewPolicyCoverageState(value: unknown): value is ReviewPolicyCoverageState {
  return typeof value === "string" && COVERAGE_STATES.has(value as ReviewPolicyCoverageState);
}
