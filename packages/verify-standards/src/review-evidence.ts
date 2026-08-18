/**
 * The review-evidence check.
 *
 * `@vespeneventures/governance/review` already owns the hard part: a
 * vendor-neutral evidence schema, a consumer-owned policy shape, and a
 * deterministic validator that binds every review record, check, and thread
 * to the exact head it was observed against. This module does not
 * reimplement any of that — it calls it, and then does the one thing that
 * validator deliberately does not do: decide which of its findings mean
 * *the change failed review* and which mean *the evidence could not be
 * evaluated*.
 *
 * That distinction is invisible in a flat finding list, and getting it wrong
 * in the permissive direction is this repository's #256 defect exactly.
 * `validateReviewEvidence` reports a malformed bundle, an unsupported schema
 * version, and an incompletely-paginated collection through the same
 * `severity: "error"` channel it reports an unresolved thread or a failing
 * required check. A caller that folds all of them into "fail" is at least
 * safe; a caller that folds a malformed bundle into "the reviewer said no"
 * has mislabelled its own outage as a verdict, and will go looking for a
 * reviewer who was never there.
 *
 * So every rule that validator can emit is partitioned here, exhaustively
 * and by type, into `evaluability` (→ `indeterminate`) and `violation`
 * (→ `violated`). The partition is a total `Record` over the rule union, so
 * adding a rule upstream without classifying it here is a compile error
 * rather than a silent default in whichever direction the code happened to
 * fall.
 *
 * Zero I/O. Every input is caller-supplied — including the evidence bundle
 * itself, which a consumer's own workflow collects (its credentials, its
 * network) and hands over as data. `@vespeneventures/governance/review/github`
 * can turn a provider payload into that bundle without any network access of
 * its own.
 */

import { createGateReasons, gateSatisfied, gateViolated } from "@vespeneventures/governance/gates";
import type { GateResult } from "@vespeneventures/governance/gates";
import { validateReviewEvidence, validateReviewPolicy } from "@vespeneventures/governance/review";
import type { ReviewEvidenceBundle, ReviewFinding, ReviewFindingRule, ReviewPolicy } from "@vespeneventures/governance/review";
import type { CheckFinding } from "./types.js";

/** Requirements this check adds on top of whatever the review policy already demands. */
export interface ReviewEvidenceOptions {
  /**
   * The commit actually under test. When supplied, evidence bound to any
   * other head is `indeterminate` — evidence about a different commit is not
   * evidence that this one is bad, it is the absence of evidence about this
   * one, and those must not share a verdict.
   */
  readonly headShaUnderTest?: string;
  /**
   * Whether at least one review record at the current head is required
   * regardless of what the policy's verdict rules say. Explicit boolean, no
   * default: an advisory policy legitimately requires no approval, and
   * whether "nobody looked at all" is nonetheless a failure is a consuming
   * repository's decision, not this package's.
   */
  readonly requireReviewPresence: boolean;
}

/** Every reason this check can decline to answer. */
export const reviewEvidenceReasons = createGateReasons([
  "no-evidence-supplied",
  "no-policy-supplied",
  "no-options-supplied",
  "policy-invalid",
  "evidence-malformed",
  "evidence-incomplete",
  "evidence-head-mismatch",
] as const);

export type ReviewEvidenceReason = (typeof reviewEvidenceReasons.reasons)[number];

/** One reportable problem with a change's review evidence. */
export interface ReviewEvidenceFinding extends CheckFinding {
  readonly rule: ReviewFindingRule | "review-presence-missing";
}

/**
 * How each rule `validateReviewEvidence` and its shape checks can emit is
 * treated here.
 *
 * `"evaluability"` — the bundle itself cannot be believed (wrong shape,
 * wrong schema version, a field that is not what it claims, a collection
 * that was never fully read). Nothing about the change has been established,
 * in either direction.
 *
 * `"violation"` — the bundle was read successfully and the change does not
 * satisfy the policy.
 *
 * A total `Record` over the union, so this stays exhaustive by construction.
 */
const RULE_CLASS: Record<ReviewFindingRule, "evaluability" | "violation"> = {
  // The policy could not be understood. Reported separately (see below), but
  // classified here too so the record stays total.
  "policy-shape": "evaluability",
  "policy-unknown-field": "evaluability",
  "required-checks-shape": "evaluability",
  "required-check-name": "evaluability",
  "duplicate-required-check": "evaluability",
  "require-approval": "evaluability",
  "require-secondary-review": "evaluability",
  "decision-use": "evaluability",
  "advisory-approval-conflict": "evaluability",
  "advisory-secondary-conflict": "evaluability",
  // The evidence bundle could not be understood.
  "evidence-shape": "evaluability",
  "evidence-unknown-field": "evaluability",
  "schema-version": "evaluability",
  "head-sha": "evaluability",
  "base-sha": "evaluability",
  "patch-id": "evaluability",
  "pagination-incomplete": "evaluability",
  "checks-shape": "evaluability",
  "check-shape": "evaluability",
  "check-unknown-field": "evaluability",
  "check-name": "evaluability",
  "check-conclusion": "evaluability",
  "reviews-shape": "evaluability",
  "review-shape": "evaluability",
  "review-unknown-field": "evaluability",
  "review-id": "evaluability",
  "reviewer-id": "evaluability",
  "review-instance-id": "evaluability",
  "review-provider": "evaluability",
  "review-submitted-at": "evaluability",
  "review-state": "evaluability",
  "review-depth": "evaluability",
  "threads-shape": "evaluability",
  "thread-shape": "evaluability",
  "thread-unknown-field": "evaluability",
  "thread-id": "evaluability",
  "thread-resolution": "evaluability",
  // Evidence about a head other than the one it claims. The bundle is
  // internally consistent; it is simply about a change that no longer exists
  // in the form it was reviewed.
  "stale-evidence": "evaluability",
  // The bundle was read, and the change does not satisfy the policy.
  "missing-required-check": "violation",
  "required-check-failed": "violation",
  "approval-missing": "violation",
  "secondary-review-missing": "violation",
  "changes-requested": "violation",
  "review-decision-ambiguous": "violation",
  "unresolved-thread": "violation",
};

/**
 * The reason reported for an evaluability-class rule. `pagination-incomplete`
 * gets its own reason because it is a genuinely different situation from a
 * malformed bundle: the shape was right and the caller simply did not finish
 * reading, which is a caller-side fix rather than a schema mismatch.
 */
function evaluabilityReason(rule: ReviewFindingRule): ReviewEvidenceReason {
  return rule === "pagination-incomplete" ? "evidence-incomplete" : "evidence-malformed";
}

function toFinding(finding: ReviewFinding): ReviewEvidenceFinding {
  return { rule: finding.rule, severity: "error", path: finding.path, message: finding.message };
}

/** What the check concluded. */
export interface ReviewEvidenceReport {
  readonly result: GateResult<ReviewEvidenceFinding, ReviewEvidenceReason>;
  /** Distinct review providers observed at the current head, for the report. Never used as authority. */
  readonly providersObserved: readonly string[];
}

/** Evaluates one change's review evidence against a consumer-owned review policy. */
export function checkReviewEvidence(
  evidence: unknown,
  policy: unknown,
  options: ReviewEvidenceOptions,
): ReviewEvidenceReport {
  const empty: readonly string[] = [];
  if (evidence === undefined || evidence === null) {
    return {
      providersObserved: empty,
      result: reviewEvidenceReasons.indeterminate(
        "no-evidence-supplied",
        "No review-evidence bundle was supplied. A change nobody collected evidence for has not been shown to be reviewed.",
      ),
    };
  }
  if (policy === undefined || policy === null) {
    return {
      providersObserved: empty,
      result: reviewEvidenceReasons.indeterminate(
        "no-policy-supplied",
        "No review policy was supplied. This package holds no default review requirements.",
      ),
    };
  }

  const policyFindings = validateReviewPolicy(policy);
  if (policyFindings.length > 0) {
    return {
      providersObserved: empty,
      result: reviewEvidenceReasons.indeterminate(
        "policy-invalid",
        `The review policy is not valid, so there is nothing to hold the evidence to: ${describe(policyFindings)}`,
      ),
    };
  }

  const evidenceFindings = validateReviewEvidence(evidence, policy as ReviewPolicy);
  const evaluability = evidenceFindings.filter((item) => RULE_CLASS[item.rule] === "evaluability");
  if (evaluability.length > 0) {
    const first = evaluability[0] as ReviewFinding;
    return {
      providersObserved: empty,
      result: reviewEvidenceReasons.indeterminate(
        evaluabilityReason(first.rule),
        `The evidence bundle cannot be evaluated: ${describe(evaluability)}`,
      ),
    };
  }

  // Past the evaluability gate the bundle is known well-formed, so it is safe
  // to read its own fields for the two checks below.
  const bundle = evidence as ReviewEvidenceBundle;
  const providersObserved = [
    ...new Set(bundle.reviews.filter((review) => review.headSha === bundle.headSha).map((review) => review.provider)),
  ].sort();

  if (options.headShaUnderTest !== undefined && options.headShaUnderTest !== bundle.headSha) {
    return {
      providersObserved,
      result: reviewEvidenceReasons.indeterminate(
        "evidence-head-mismatch",
        `The evidence is bound to head ${bundle.headSha} and the commit under test is ${options.headShaUnderTest}. ` +
          "Evidence about a different commit is not evidence about this one.",
      ),
    };
  }

  const violations = evidenceFindings.filter((item) => RULE_CLASS[item.rule] === "violation").map(toFinding);

  if (options.requireReviewPresence) {
    const reviewsAtHead = bundle.reviews.filter((review) => review.headSha === bundle.headSha);
    if (reviewsAtHead.length === 0) {
      violations.push({
        rule: "review-presence-missing",
        severity: "error",
        path: "reviews",
        message:
          `No review record at all exists for head ${bundle.headSha}. Presence was required independently of the ` +
          "policy's verdict rules, so a policy that demands no approval still demands that somebody looked.",
      });
    }
  }

  if (violations.length > 0) return { providersObserved, result: gateViolated(violations) };

  // Coverage, stated honestly: how many discrete pieces of evidence were
  // actually read. A bundle carrying nothing at all cannot report satisfied —
  // `gateSatisfied` refuses a zero count — which is the correct outcome for
  // an empty bundle that happens to violate nothing.
  const evaluated = bundle.checks.length + bundle.reviews.length + bundle.threads.length;
  if (evaluated === 0) {
    return {
      providersObserved,
      result: reviewEvidenceReasons.indeterminate(
        "evidence-incomplete",
        "The evidence bundle is well-formed and completely empty: no checks, no reviews, no threads. There is nothing " +
          "in it to have satisfied anything.",
      ),
    };
  }
  return { providersObserved, result: gateSatisfied(evaluated) };
}

function describe(findings: readonly ReviewFinding[]): string {
  return findings.map((item) => `${item.rule} (${item.path}): ${item.message}`).join("; ");
}
