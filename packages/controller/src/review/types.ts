/** The only review evidence schema supported by this package version. */
export const REVIEW_EVIDENCE_VERSION = 3 as const;

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

/**
 * A check observed while gathering evidence for one exact proposed-change
 * head. A provider's status-check collection reports every RUN for `name` at
 * this head, not one current value per name -- the same check can appear
 * here more than once (a failed attempt and its later, passing re-run both
 * show up as separate `ReviewCheck` entries). `completedAt` is what lets
 * validation tell those apart: it is the completion timestamp of THIS run,
 * so grading a required check means grouping its entries by `name` and
 * judging the one with the latest `completedAt`, never the first (or last)
 * one encountered in whatever order the caller's array happens to hold them.
 *
 * `completedAt` is optional, unlike `ReviewRecord.submittedAt`, because a
 * run that has not finished yet genuinely has no completion time -- that is
 * a true fact about the run, not a caller omission to reject the way a
 * missing `submittedAt` is. A single current-head entry for a name never
 * needs it: with nothing to compare against, that entry already is "the"
 * run for `name`. It matters only once a second entry for the same `name`
 * shows up; see `validate.ts`'s grouping logic for what happens then --
 * multiple entries with no comparable timestamp, or tied timestamps that
 * disagree on `conclusion`, are never resolved by array order. Ordering by
 * array position would silently reintroduce this package's own
 * first-match-wins incident (see `ReviewFindingRule`'s
 * `"required-check-indeterminate"` doc comment).
 */
export interface ReviewCheck {
  readonly name: string;
  readonly conclusion: ReviewCheckConclusion;
  readonly headSha: string;
  readonly completedAt?: string;
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
 * Depth actually reached by one review record, expressed with the same
 * tri-state discipline as `ReviewPolicyAdoptionState` /
 * `ReviewPolicyCoverageState` below: a real third state gets its own named
 * value rather than being collapsed into a boolean or inferred by comparing
 * against what a policy demanded.
 *
 * `"primary"` — an ordinary single-pass review; no secondary pass was
 * attempted or required. `"secondary"` — a second, independent pass reached
 * a decisive result at that depth; only a `"secondary"` record can ever
 * satisfy `ReviewPolicy.requireSecondaryReview`. `"secondary-incomplete"` —
 * the record itself states that the depth a policy would demand was
 * attempted and not reached; this is a first-class, explicitly reported
 * fact, not this package's inference. A record can be decisive
 * (`state: "approved"`) about what it did review while still declaring
 * `"secondary-incomplete"` — a clean primary-depth result never upgrades
 * itself into a satisfied secondary requirement. See `validateReviews` for
 * why `state` alone (clean vs. negative) cannot express this: depth and
 * decision are orthogonal facts about one record.
 */
export type ReviewDepth = "primary" | "secondary" | "secondary-incomplete";

/**
 * A review decision observed while gathering evidence for one exact
 * proposed-change head. `reviewerId` is provider-neutral and opaque, and
 * remains purely descriptive data on the record. It is `instanceId` —
 * required, unique per review session — that validation actually groups and
 * applies latest-wins on: a consuming account's records can carry the same
 * `reviewerId` (even the same login) for every audit it ever runs, so
 * `reviewerId` alone cannot tell two genuinely independent reviews apart
 * from one review revising itself. `instanceId` is caller-assigned and
 * opaque; this package defines no scheme for it beyond "stable for one
 * review session, distinct across sessions."
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
 *
 * `depth` is a third, independent fact: how far this record's review
 * actually went, never derivable from `state` or `provider`. See
 * `ReviewDepth`.
 */
export interface ReviewRecord {
  readonly id: string;
  readonly reviewerId: string;
  readonly instanceId: string;
  readonly provider: string;
  readonly submittedAt: string;
  readonly state: ReviewDecision;
  readonly depth: ReviewDepth;
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
 *
 * `patchId` is a caller-supplied identity for the change itself — the diff,
 * not the commit — stable across a base-only advance the way `headSha` is
 * not. Git's `patch-id` is the established analogue, but this package
 * neither computes one nor assumes that exact algorithm or output shape: it
 * is opaque, caller-supplied data, taken on the same terms as `headSha` is
 * (this package performs no Git, filesystem, or network I/O to produce
 * either), never validated against a fixed format the way `headSha` is,
 * because constraining it to one scheme's output shape would silently
 * assume every caller uses that scheme.
 *
 * `patchId` is optional, unlike every other identity field on this bundle.
 * `headSha` and `baseSha` are required because a bundle without them cannot
 * say what it is evidence FOR at all. `patchId`'s absence carries no such
 * ambiguity: it means only "this bundle carries no patch-identity
 * information," which leaves every existing head-binding guarantee on this
 * bundle completely intact and simply means `isRevalidatableReviewEvidence`
 * can never return true for it — there is no silent default direction to
 * get wrong the way `decisionUse` and `provider` each has one. See
 * `isRevalidatableReviewEvidence`.
 */
export interface ReviewEvidenceBundle {
  readonly schemaVersion: typeof REVIEW_EVIDENCE_VERSION;
  readonly headSha: string;
  readonly baseSha: string;
  readonly patchId?: string;
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
   * Whether a second, independent review reaching `depth: "secondary"` and a
   * clean decisive state is required, on top of whatever `requireApproval`
   * already demands. Required, with no default, for the same reason
   * `requireApproval` itself has none: a silently-assumed `false` would make
   * an account's real secondary-review requirement invisible to the one
   * mechanism meant to enforce it, which is exactly the failure this field
   * exists to close (see this module's own review history: a reviewer
   * correctly declared incomplete depth and the consuming gate passed
   * anyway, because it read only `state`). A record satisfies this only
   * through `depth: "secondary"` together with a clean decisive `state`; a
   * `"secondary-incomplete"` record, or a `"secondary"` record whose state
   * is not clean, never does. See `ReviewDepth`.
   */
  readonly requireSecondaryReview: boolean;
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
   * `requireSecondaryReview: true` combined with `decisionUse: "advisory"`
   * is rejected the same way `requireApproval: true` is: an advisory model
   * can never let any review signal, primary or secondary, grant clearance.
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
  | "require-secondary-review"
  | "decision-use"
  | "advisory-approval-conflict"
  | "advisory-secondary-conflict"
  | "evidence-shape"
  | "evidence-unknown-field"
  | "schema-version"
  | "head-sha"
  | "base-sha"
  | "patch-id"
  | "pagination-incomplete"
  | "checks-shape"
  | "check-shape"
  | "check-unknown-field"
  | "check-name"
  | "check-conclusion"
  | "check-completed-at"
  | "reviews-shape"
  | "review-shape"
  | "review-unknown-field"
  | "review-id"
  | "reviewer-id"
  | "review-instance-id"
  | "review-provider"
  | "review-submitted-at"
  | "review-state"
  | "review-depth"
  | "threads-shape"
  | "thread-shape"
  | "thread-unknown-field"
  | "thread-id"
  | "thread-resolution"
  | "stale-evidence"
  | "missing-required-check"
  | "required-check-failed"
  /**
   * A required check exists in the evidence, current-head and otherwise
   * well-formed, but this package will not guess which of its runs is the
   * one that counts. Two situations produce this, and both are the
   * `indeterminate` half of the ternary contract every check evaluation in
   * this package follows (never pass, never fail, when the true answer is
   * simply unknown -- see `@vespeneventures/integrator`'s
   * `classifyCurrencyDistance` doc comment (`src/currency.ts`) for the
   * canonical statement of that reasoning, applied here to check evaluation
   * instead of version comparison):
   *
   * 1. `paginationComplete` is not `true`. A later, unread page could hold a
   *    newer run of this exact name, so whatever this page already shows --
   *    even a clean `"success"` -- cannot be trusted as the LATEST run.
   *    Reported for every required check while pagination is incomplete,
   *    regardless of what has already been observed for it.
   * 2. More than one current-head run for this name was observed, and
   *    recency cannot be decided between them: either at least one of those
   *    runs carries no usable `completedAt` (see `ReviewCheck`'s own doc
   *    comment for why that is a legitimate, not-a-shape-defect state), or
   *    every run at the latest `completedAt` does not agree on
   *    `conclusion`. Either way there is no non-arbitrary way to pick a
   *    winner, so none is picked.
   *
   * This is the fix for the incident this rule exists to prevent: grading
   * a required check by finding the first matching name in an unordered,
   * possibly-repeated-per-name collection, so that a genuinely later
   * success could never clear an earlier failure the collection also still
   * carries. Never reported alongside `"missing-required-check"` or
   * `"required-check-failed"` for the SAME required check -- for one name,
   * exactly one of the three fires, per the ternary contract above.
   */
  | "required-check-indeterminate"
  | "approval-missing"
  | "secondary-review-missing"
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
