/** The only review evidence schema supported by this package version. */
export const REVIEW_EVIDENCE_VERSION = 2 as const;

/** Dense, read-only lists accepted by the evidence contracts. */
export type ReviewList<T> = readonly T[];

/** Normalized completion states for a check attached to a proposed change. */
export type ReviewCheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "skipped"
  | "cancelled"
  | "timed-out"
  | "action-required"
  | "pending"
  | "unknown";

/** A check observed while gathering evidence for one exact proposed-change head. */
export interface ReviewCheck {
  readonly name: string;
  readonly conclusion: ReviewCheckConclusion;
  readonly headSha: string;
}

/** Normalized state of one human or automated review decision. */
export type ReviewDecision =
  | "approved"
  | "changes-requested"
  | "commented"
  | "dismissed"
  | "pending"
  | "unknown";

/**
 * A review decision observed while gathering evidence for one exact
 * proposed-change head. `reviewerId` is provider-neutral and opaque; together
 * with `submittedAt` it lets validation apply each reviewer's latest decision.
 *
 * `provider` is a second, independent opaque identifier: which analyzer
 * produced this record (a human review client, or an automated review tool).
 * It is required and caller-supplied — this package defines no vendor enum,
 * no allowlist, and no notion of a "trusted" or "appointed" provider. Nothing
 * here lets any provider's output grant merge clearance; that would recreate
 * the same approval-as-clearance problem `ReviewPolicy.decisionUse` exists to
 * reject, just keyed by tool instead of by human identity. Which providers an
 * account actually appointed is an account-owned value that never lives in
 * this package.
 */
export interface ReviewRecord {
  readonly id: string;
  readonly reviewerId: string;
  readonly provider: string;
  readonly submittedAt: string;
  readonly state: ReviewDecision;
  readonly headSha: string;
}

/** A discussion thread observed while gathering evidence for one exact proposed-change head. */
export interface ReviewThread {
  readonly id: string;
  readonly isResolved: boolean;
  readonly headSha: string;
}

/**
 * Provider-neutral snapshot used to decide whether a proposed change may pass
 * a review policy. Each item carries the head identifier it was observed
 * against, so stale evidence cannot be mistaken for current evidence.
 * `headSha` and `baseSha` together bind evidence to the exact merge that
 * would result: a review record surviving a base change (the target branch
 * moving underneath an otherwise-unchanged head) would otherwise validate
 * against a merge result it never actually saw.
 */
export interface ReviewEvidenceBundle {
  readonly schemaVersion: typeof REVIEW_EVIDENCE_VERSION;
  readonly headSha: string;
  readonly baseSha: string;
  /** True only when every paginated evidence collection was fully consumed. */
  readonly paginationComplete: boolean;
  readonly checks: ReviewList<ReviewCheck>;
  readonly reviews: ReviewList<ReviewRecord>;
  readonly threads: ReviewList<ReviewThread>;
}

/**
 * Whether a policy's `requireApproval` functions as merge-blocking clearance
 * ("authoritative") or as an audit signal only ("advisory"). Under
 * "advisory", an approval can never satisfy anything — merge authority rests
 * solely with ordinary CI and repository rules — so `requireApproval: true`
 * combined with `decisionUse: "advisory"` is self-contradictory and is
 * rejected by `validateReviewPolicy` before any evidence is read.
 */
export type ReviewPolicyDecisionUse = "advisory" | "authoritative";

/** Consumer-owned requirements for one review decision. */
export interface ReviewPolicy {
  /** Names of checks that must report success for the current head. */
  readonly requiredChecks: ReviewList<string>;
  /** Whether one current-head approval is required. */
  readonly requireApproval: boolean;
  /**
   * Whether `requireApproval` is merge-blocking clearance or an audit signal
   * only. Required, with no default. An omitted value is rejected rather
   * than defaulted in either direction: defaulting to `"authoritative"`
   * would silently keep approval-as-clearance semantics for every existing
   * caller that never actually chose them (the wrong failure direction for
   * a package whose charter is to never grant merge authority by accident),
   * and defaulting to `"advisory"` would silently reinterpret an existing
   * `requireApproval: true` policy's intent instead of asking. Every other
   * field on this type already follows the same no-default, fail-closed
   * discipline (`requireApproval` must be an explicit boolean; there is no
   * silently-assumed `false`), so requiring `decisionUse` explicitly is
   * consistent with the existing contract, not a new exception to it.
   */
  readonly decisionUse: ReviewPolicyDecisionUse;
}

/**
 * Whether a consuming repository has turned on ("adopted") a given review
 * policy. A tri-state: pass ("adopted"), fail ("not-adopted"), and an
 * explicit third state for "this has not been assessed yet" so a caller can
 * never mistake "unchecked" for "passing". See `ReviewPolicyCoverageState`
 * for why this is a structurally separate value, never one this package
 * lets a caller derive or default from the other.
 */
export type ReviewPolicyAdoptionState = "adopted" | "not-adopted" | "assessment-pending";

/**
 * Whether a consuming repository's real pull requests have actually been
 * reviewed under an adopted policy — as opposed to the policy merely being
 * turned on. A repository adopting a policy is not evidence its pull
 * requests were ever reviewed under it, so this is modeled as an entirely
 * separate vocabulary from `ReviewPolicyAdoptionState`: the two share no
 * validator, no shared internal state, and no fallback path between them.
 * `isReviewPolicyCoverageState` accepts none of `ReviewPolicyAdoptionState`'s
 * pass/fail values (`"adopted"` / `"not-adopted"`) and vice versa, so
 * coverage can never be silently satisfied by an adoption value alone — only
 * the shared "not yet assessed" state means the same thing in both
 * vocabularies. Foundry supplies this vocabulary and its validator only; the
 * per-repository adoption and coverage values themselves are each
 * consuming account's own data, never foundry's.
 */
export type ReviewPolicyCoverageState = "verified" | "not-verified" | "assessment-pending";

export type ReviewFindingRule =
  | "policy-shape"
  | "policy-unknown-field"
  | "required-checks-shape"
  | "required-check-name"
  | "duplicate-required-check"
  | "require-approval"
  | "decision-use"
  | "advisory-approval-conflict"
  | "evidence-shape"
  | "evidence-unknown-field"
  | "schema-version"
  | "head-sha"
  | "base-sha"
  | "pagination-incomplete"
  | "checks-shape"
  | "check-shape"
  | "check-unknown-field"
  | "check-name"
  | "check-conclusion"
  | "reviews-shape"
  | "review-shape"
  | "review-unknown-field"
  | "review-id"
  | "reviewer-id"
  | "review-provider"
  | "review-submitted-at"
  | "review-state"
  | "threads-shape"
  | "thread-shape"
  | "thread-unknown-field"
  | "thread-id"
  | "thread-resolution"
  | "stale-evidence"
  | "missing-required-check"
  | "required-check-failed"
  | "approval-missing"
  | "changes-requested"
  | "review-decision-ambiguous"
  | "unresolved-thread";

/** A stable, deterministic reason review evidence does not satisfy its policy. */
export interface ReviewFinding {
  readonly rule: ReviewFindingRule;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
}
