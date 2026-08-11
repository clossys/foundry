/** The only review evidence schema supported by this package version. */
export const REVIEW_EVIDENCE_VERSION = 1 as const;

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

/** A review decision observed while gathering evidence for one exact proposed-change head. */
export interface ReviewRecord {
  readonly id: string;
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
 */
export interface ReviewEvidenceBundle {
  readonly schemaVersion: typeof REVIEW_EVIDENCE_VERSION;
  readonly headSha: string;
  /** True only when every paginated evidence collection was fully consumed. */
  readonly paginationComplete: boolean;
  readonly checks: ReviewList<ReviewCheck>;
  readonly reviews: ReviewList<ReviewRecord>;
  readonly threads: ReviewList<ReviewThread>;
}

/** Consumer-owned requirements for one review decision. */
export interface ReviewPolicy {
  /** Names of checks that must report success for the current head. */
  readonly requiredChecks: ReviewList<string>;
  /** Whether one current-head approval is required. */
  readonly requireApproval: boolean;
}

export type ReviewFindingRule =
  | "policy-shape"
  | "policy-unknown-field"
  | "required-checks-shape"
  | "required-check-name"
  | "duplicate-required-check"
  | "require-approval"
  | "evidence-shape"
  | "evidence-unknown-field"
  | "schema-version"
  | "head-sha"
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
  | "unresolved-thread";

/** A stable, deterministic reason review evidence does not satisfy its policy. */
export interface ReviewFinding {
  readonly rule: ReviewFindingRule;
  readonly severity: "error";
  readonly path: string;
  readonly message: string;
}
