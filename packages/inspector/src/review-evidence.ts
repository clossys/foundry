/**
 * The review-evidence check.
 *
 * `@clossys/controller/review` already owns the hard part: a
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
 * ONE CARVE-OUT: A STALE REVIEW RECORD IS NEITHER, EXCEPT A STALE OBJECTION
 * ----------------------------------------------------------------------------
 * `"stale-evidence"` is, by rule, `evaluability` — the same #256 discipline:
 * evidence about a different commit is not evidence about this one, in
 * either direction, so folding it into a verdict would be exactly the
 * mistake this module exists to prevent. That is correct for a stale CHECK
 * or a stale THREAD, where it means the bundle disagrees with itself about
 * which head it describes. It stops being correct for a stale REVIEW
 * specifically: `validateReviews` (`@clossys/controller/review/validate`)
 * already reads a review's own `headSha` — the exact commit that review was
 * actually submitted against, never invented — and, on a mismatch, excludes
 * that record from `hasApproval`, `hasChangesRequested`, and every other
 * decisive signal on its own, `continue`-ing past it entirely. So a review
 * left behind by a force-push is already harmless to the verdict before this
 * module ever sees it; the `"stale-evidence"` finding attached to it adds no
 * new fact, and forcing the WHOLE check to `indeterminate` over a record
 * that could never have swung the decision anyway inverts this repository's
 * own stated intent for this exact rule (see `.github/workflows/
 * verify-standards.yml`'s "avoids folding a stale approval into either a
 * pass or a fail" — a stale record folded into NEITHER a pass nor a fail is
 * `indeterminate` for the record, not for the whole run). A rate-limited bot
 * that left one `COMMENTED` review at an earlier head and cannot re-review
 * (#1187, #1297, #1302) made this concrete: every push on a merge train
 * marks its own review stale, and every push after that keeps the PR
 * `indeterminate` forever, on a required check, even though a PR with NO
 * review at all passes cleanly.
 *
 * `staleReviewCarveOutEligible` below pulls a `"stale-evidence"` finding OUT
 * of the `evaluability` set only when the review it names has a genuine,
 * well-formed `headSha` that simply names a different commit — never a
 * missing or malformed one. A review with no recorded commit (this
 * repository's own collector, `scripts/collect-review-evidence.mjs` — a
 * repository-root script that never ships with this package, the same as
 * every other `scripts/` path, because `scripts/` is not part of any
 * package's `files` allowlist and so is not present once a package is
 * installed from the registry — writes an empty `headSha` when GitHub's own
 * payload carries no `commit.oid`) is UNKNOWN, not stale: there is no fact
 * to exclude it on, so it stays `evaluability` exactly as before.
 * Carved-out findings are reported on `ReviewEvidenceReport.staleReviews` —
 * visible, never silently dropped — and can never, by themselves, produce
 * `indeterminate`.
 *
 * A stale APPROVAL still can never count, because `validateReviews` already
 * excluded it from `hasApproval` before this module runs. A stale
 * CHANGES_REQUESTED is different, and does NOT get the same free pass: if a
 * reviewer's own LATEST decisive review (`approved`, `changes-requested`, or
 * `dismissed` — `validateReviews`' own definition of "decisive", read across
 * every head this bundle carries, not only the current one) is a
 * changes-requested at a stale head, `findStaleChangesRequestedViolations`
 * below reports it as a `"stale-changes-requested"` violation. An ordinary
 * push must not be able to silently clear a human reviewer's objection —
 * this repository's own branch ruleset carries no `pull_request` review
 * rule, so `verify-standards` is the only mechanical enforcement of a
 * requested change, and an agent operating under a standing autonomous-merge
 * authorization must not be able to land a change over one just because it
 * pushed again. Only that reviewer's own later act — approving anew,
 * dismissing the request, or requesting changes again — can supersede it, the
 * same "latest decisive record per review session, never by array position"
 * rule `validateReviews` already applies at the current head; this function
 * applies it across every head instead, because a stale objection is
 * precisely the one stale record this module must not let a push discard.
 *
 * Excluding a review from `evaluability` also excludes it from
 * `evaluated` — see `checkReviewEvidence`'s own comment on that count. A
 * bundle whose only reviews are stale reads exactly as a bundle with no
 * reviews at all: `satisfied` only because presence was not required, or
 * `violated` on `"review-presence-missing"` when it was, never a false
 * `satisfied` claiming to have evaluated a record this module just excluded.
 *
 * Zero I/O. Every input is caller-supplied — including the evidence bundle
 * itself, which a consumer's own workflow collects (its credentials, its
 * network) and hands over as data. `@clossys/controller/review/github`
 * can turn a provider payload into that bundle without any network access of
 * its own.
 */

import { createGateReasons, gateSatisfied, gateViolated } from "@clossys/controller/gates";
import type { GateResult } from "@clossys/controller/gates";
import { validateReviewEvidence, validateReviewPolicy } from "@clossys/controller/review";
import type { ReviewEvidenceBundle, ReviewFinding, ReviewFindingRule, ReviewPolicy, ReviewRecord } from "@clossys/controller/review";
import { isRecord, isRecordArray } from "./shape.js";
import type { CheckFinding } from "./types.js";

/**
 * Mirrors `@clossys/controller/review/validate`'s own `SHA` pattern. Not
 * imported — this package reads `@clossys/controller`'s *validated* output
 * (`ReviewEvidenceBundle`, findings), never its internal helpers, and this
 * check exists specifically to answer a question `validateReviewEvidence`'s
 * own findings cannot: whether ONE `"stale-evidence"` finding names a review
 * with a well-formed-but-different `headSha` (stale) or an absent/malformed
 * one (unknown) — a distinction its `path` alone (`reviews[<index>].headSha`
 * either way) does not carry.
 */
const REVIEW_SHA_PATTERN = /^[0-9a-f]{40}$/;

function isWellFormedSha(value: unknown): value is string {
  return typeof value === "string" && REVIEW_SHA_PATTERN.test(value);
}

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
  readonly rule: ReviewFindingRule | "review-presence-missing" | "stale-changes-requested";
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
  "check-completed-at": "evaluability",
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
  // A required check exists but this package would have to guess which of
  // its several runs is the current one (an unread page might hold a newer
  // run, or the runs it did read cannot be ordered without inventing an
  // order it has no basis for) -- see ReviewFindingRule's own doc comment.
  // Nothing about this change's checks has been established in either
  // direction, so this is evaluability, not a violation, the same as
  // "pagination-incomplete" above.
  "required-check-indeterminate": "evaluability",
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
 * and `required-check-indeterminate` both get `"evidence-incomplete"`
 * because both are a genuinely different situation from a malformed bundle:
 * the shape was right and there simply is not enough settled information yet
 * to decide a required check's current state (an unread page, an
 * un-orderable set of runs) -- a caller-side gap to close, not a schema
 * mismatch.
 */
function evaluabilityReason(rule: ReviewFindingRule): ReviewEvidenceReason {
  return rule === "pagination-incomplete" || rule === "required-check-indeterminate" ? "evidence-incomplete" : "evidence-malformed";
}

function toFinding(finding: ReviewFinding): ReviewEvidenceFinding {
  return { rule: finding.rule, severity: "error", path: finding.path, message: finding.message };
}

/** `evidence.reviews`, read defensively and without trusting its shape. */
function rawReviews(evidence: unknown): readonly Record<string, unknown>[] {
  if (!isRecord(evidence)) return [];
  return isRecordArray(evidence.reviews) ? evidence.reviews : [];
}

/** `evidence.headSha`, read defensively — the reference a review's own `headSha` is compared against below. */
function rawHeadSha(evidence: unknown): unknown {
  return isRecord(evidence) ? evidence.headSha : undefined;
}

/**
 * Matches a `"stale-evidence"` finding's `path` — `reviews[<index>]...` —
 * back to that entry's own position in `evidence.reviews`, so the raw record
 * can be read directly. `validateReviewEvidence`'s findings never carry the
 * raw value themselves.
 */
const REVIEW_STALE_EVIDENCE_PATH = /^reviews\[(\d+)\]\.headSha$/;

/**
 * Whether a `"stale-evidence"` finding is eligible for this file's own
 * carve-out (see the header, "ONE CARVE-OUT: A STALE REVIEW RECORD IS
 * NEITHER, EXCEPT A STALE OBJECTION"): the finding names a REVIEW entry
 * specifically — never a check or a thread, which stay `evaluability` — AND
 * that review's own `headSha` is a well-formed 40-lowercase-hex commit that
 * simply differs from the bundle's. A missing or malformed `headSha` (this
 * repository's own collector writes `""` when GitHub returns no
 * `commit.oid`) is UNKNOWN, not stale, and is deliberately NOT carved out —
 * `path` alone cannot tell the two apart, so this reads the raw record.
 */
function staleReviewCarveOutEligible(item: ReviewFinding, reviews: readonly Record<string, unknown>[], headSha: unknown): boolean {
  if (item.rule !== "stale-evidence") return false;
  const match = REVIEW_STALE_EVIDENCE_PATH.exec(item.path);
  if (!match) return false;
  const index = Number(match[1]);
  const review = reviews[index];
  const itemHeadSha = isRecord(review) ? review.headSha : undefined;
  return isWellFormedSha(itemHeadSha) && itemHeadSha !== headSha;
}

/**
 * `@clossys/controller/review/validate`'s own `ReviewDecision` values that
 * count as a decisive outcome for one review session — mirrors
 * `validateReviews`' own `state !== "approved" && state !==
 * "changes-requested" && state !== "dismissed"` filter exactly, because
 * `findStaleChangesRequestedViolations` below is answering the identical
 * question (`validateReviews` does) over a wider set (every head this
 * bundle carries, not only the current one).
 */
const DECISIVE_REVIEW_STATES = new Set<ReviewRecord["state"]>(["approved", "changes-requested", "dismissed"]);

/**
 * For each review session (`instanceId`), finds that session's own LATEST
 * decisive record — by `submittedAt`, never by array position, the same
 * discipline `validateReviews` already applies at the current head — across
 * EVERY head the bundle carries. Two outcomes:
 *
 *   - A genuine latest (a strictly later `submittedAt`, or the only decisive
 *     record for that instance): when it is a `changes-requested` whose own
 *     `headSha` is not the bundle's current head, reports a
 *     `"stale-changes-requested"` violation — see this file's header for why
 *     an ordinary push must not be able to silently clear it.
 *   - A TIE: two decisive records for the same instance share the same
 *     `submittedAt` and disagree on `state`. `validateReviews`
 *     (`@clossys/controller/review/validate`) already refuses to invent an
 *     order for exactly this shape at the current head — its own
 *     `hasAmbiguousDecision` — reporting `"review-decision-ambiguous"`
 *     (a `violation`, per this file's own `RULE_CLASS`) rather than letting
 *     array position pick a winner. This function mirrors that same rule and
 *     the same classification across every head instead of only the current
 *     one, for the identical reason: a tie between a stale
 *     `changes-requested` and a current `approved` must not fail OPEN merely
 *     because of which array index happened to be read first.
 *
 * Only called once `bundle` is known well-formed (past the evaluability
 * gate), so every candidate record's `submittedAt`, `state`, `instanceId`,
 * and `headSha` are already guaranteed valid — this performs no
 * re-validation.
 */
function findStaleChangesRequestedViolations(bundle: ReviewEvidenceBundle): ReviewEvidenceFinding[] {
  interface LatestDecisive {
    readonly index: number;
    readonly submittedAtMs: number;
    readonly review: ReviewRecord;
    readonly isAmbiguous: boolean;
  }
  const latestByInstance = new Map<string, LatestDecisive>();
  bundle.reviews.forEach((review, index) => {
    if (!DECISIVE_REVIEW_STATES.has(review.state)) return;
    const submittedAtMs = Date.parse(review.submittedAt);
    if (Number.isNaN(submittedAtMs)) return; // defensive only — already validated by this point.
    const previous = latestByInstance.get(review.instanceId);
    if (!previous || submittedAtMs > previous.submittedAtMs) {
      // A later decision is decisive even if an earlier tie was ambiguous —
      // same precedence `validateReviews` itself uses.
      latestByInstance.set(review.instanceId, { index, submittedAtMs, review, isAmbiguous: false });
    } else if (submittedAtMs === previous.submittedAtMs && review.state !== previous.review.state) {
      latestByInstance.set(review.instanceId, { ...previous, isAmbiguous: true });
    }
  });
  const findings: ReviewEvidenceFinding[] = [];
  for (const { index, review, isAmbiguous } of latestByInstance.values()) {
    if (isAmbiguous) {
      findings.push({
        rule: "review-decision-ambiguous",
        severity: "error",
        path: `reviews[${index}]`,
        message:
          `Reviewer ${JSON.stringify(review.reviewerId)} has conflicting decisive reviews that share a ` +
          "submittedAt timestamp and cannot be ordered safely -- the same rule validateReviews applies at the " +
          "current head, applied here across every head this bundle carries. Array order never breaks the tie.",
      });
      continue;
    }
    if (review.state === "changes-requested" && review.headSha !== bundle.headSha) {
      findings.push({
        rule: "stale-changes-requested",
        severity: "error",
        path: `reviews[${index}]`,
        message:
          `Reviewer ${JSON.stringify(review.reviewerId)}'s latest decisive review requested changes at head ` +
          `${review.headSha}, not the current head ${bundle.headSha}. A stale changes-requested review is never ` +
          "silently cleared by an unrelated push -- it stands until that reviewer dismisses it or submits a newer " +
          "decisive review.",
      });
    }
  }
  return findings;
}

/** What the check concluded. */
export interface ReviewEvidenceReport {
  readonly result: GateResult<ReviewEvidenceFinding, ReviewEvidenceReason>;
  /** Distinct review providers observed at the current head, for the report. Never used as authority. */
  readonly providersObserved: readonly string[];
  /**
   * Review records excluded from `evaluability` (and, consequently, from
   * `evaluated`) because they carry a well-formed `headSha` naming a commit
   * other than the bundle's current head — a rate-limited bot's `COMMENTED`
   * review left behind by a merge-train push is the motivating case (#1187,
   * #1297, #1302). Reported for visibility only: their PRESENCE here never
   * by itself produces `indeterminate`. It does not follow that `result`
   * is independent of every one of them, though — a stale record that was
   * its reviewer's own LATEST decisive `changes-requested` still produces a
   * `"stale-changes-requested"` VIOLATION in `result.findings`; see this
   * file's own header. A record here can never count as an approval, a
   * current change request, or presence.
   */
  readonly staleReviews: readonly ReviewEvidenceFinding[];
}

/** Evaluates one change's review evidence against a consumer-owned review policy. */
export function checkReviewEvidence(
  evidence: unknown,
  policy: unknown,
  options: ReviewEvidenceOptions | null | undefined,
): ReviewEvidenceReport {
  const empty: readonly string[] = [];
  const emptyFindings: readonly ReviewEvidenceFinding[] = [];
  // Options are validated before anything else is read, and validated as
  // data rather than trusted as a type. `requireReviewPresence` is a
  // required boolean with no default, so an options object this package
  // cannot read is a missing input, not an implied setting: reading it as
  // absent-therefore-false would be this package quietly choosing a
  // consuming repository's review policy and then reporting the result as
  // if the repository had chosen it. `{}` and `null` reach here from a
  // caller-assembled JSON document as easily as a correct object does.
  if (!isRecord(options) || typeof options.requireReviewPresence !== "boolean") {
    return {
      providersObserved: empty,
      staleReviews: emptyFindings,
      result: reviewEvidenceReasons.indeterminate(
        "no-options-supplied",
        "No usable review-evidence options were supplied. requireReviewPresence must be an explicit boolean, because " +
          "a default would be this package choosing a consuming repository's review policy for it.",
      ),
    };
  }
  if (options.headShaUnderTest !== undefined && typeof options.headShaUnderTest !== "string") {
    return {
      providersObserved: empty,
      staleReviews: emptyFindings,
      result: reviewEvidenceReasons.indeterminate(
        "no-options-supplied",
        "headShaUnderTest was supplied and is not a string, so the commit this run claims to be about cannot be read.",
      ),
    };
  }
  if (evidence === undefined || evidence === null) {
    return {
      providersObserved: empty,
      staleReviews: emptyFindings,
      result: reviewEvidenceReasons.indeterminate(
        "no-evidence-supplied",
        "No review-evidence bundle was supplied. A change nobody collected evidence for has not been shown to be reviewed.",
      ),
    };
  }
  if (policy === undefined || policy === null) {
    return {
      providersObserved: empty,
      staleReviews: emptyFindings,
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
      staleReviews: emptyFindings,
      result: reviewEvidenceReasons.indeterminate(
        "policy-invalid",
        `The review policy is not valid, so there is nothing to hold the evidence to: ${describe(policyFindings)}`,
      ),
    };
  }

  const evidenceFindings = validateReviewEvidence(evidence, policy as ReviewPolicy);
  // Read defensively, ahead of the evaluability gate — `staleReviewCarveOutEligible`
  // needs each review's own raw `headSha` (never available from
  // `evidenceFindings` alone) to tell a genuinely stale record apart from
  // one with no recorded commit at all. See this file's header.
  const reviewsForCarveOut = rawReviews(evidence);
  const referenceHeadSha = rawHeadSha(evidence);
  // Stale REVIEW findings are carved out of `evaluability` before anything
  // else is computed — see this file's header, "ONE CARVE-OUT: A STALE
  // REVIEW RECORD IS NEITHER, EXCEPT A STALE OBJECTION". A stale check or
  // thread finding is not carved out; those stay `evaluability`, via the
  // `RULE_CLASS` lookup below, exactly as `stale-evidence` is classified
  // there. Neither is a review with a MISSING or malformed `headSha` — only
  // a well-formed, genuinely different one is eligible.
  const staleReviewFindings = evidenceFindings.filter((item) =>
    staleReviewCarveOutEligible(item, reviewsForCarveOut, referenceHeadSha),
  );
  const evaluability = evidenceFindings.filter(
    (item) => RULE_CLASS[item.rule] === "evaluability" && !staleReviewCarveOutEligible(item, reviewsForCarveOut, referenceHeadSha),
  );
  const staleReviews = staleReviewFindings.map(toFinding);
  if (evaluability.length > 0) {
    const first = evaluability[0] as ReviewFinding;
    return {
      providersObserved: empty,
      staleReviews,
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
      staleReviews,
      result: reviewEvidenceReasons.indeterminate(
        "evidence-head-mismatch",
        `The evidence is bound to head ${bundle.headSha} and the commit under test is ${options.headShaUnderTest}. ` +
          "Evidence about a different commit is not evidence about this one.",
      ),
    };
  }

  const violations = evidenceFindings.filter((item) => RULE_CLASS[item.rule] === "violation").map(toFinding);
  // A stale review is excluded from `evaluability`, never from scrutiny: if
  // it was its own reviewer's LATEST decisive record and that record was
  // changes-requested, it still blocks — see `findStaleChangesRequestedViolations`
  // and this file's header.
  violations.push(...findStaleChangesRequestedViolations(bundle));

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

  if (violations.length > 0) return { providersObserved, staleReviews, result: gateViolated(violations) };

  // Coverage, stated honestly: how many discrete pieces of evidence were
  // actually read. A bundle carrying nothing at all cannot report satisfied —
  // `gateSatisfied` refuses a zero count — which is the correct outcome for
  // an empty bundle that happens to violate nothing. Reviews carved out of
  // `evaluability` above are excluded here too — a bundle whose only reviews
  // are stale must read exactly like a bundle with none, never as if this
  // module had evaluated a record it just excluded.
  const currentHeadReviews = bundle.reviews.filter((review) => review.headSha === bundle.headSha).length;
  const evaluated = bundle.checks.length + currentHeadReviews + bundle.threads.length;
  if (evaluated === 0) {
    return {
      providersObserved,
      staleReviews,
      result: reviewEvidenceReasons.indeterminate(
        "evidence-incomplete",
        "The evidence bundle is well-formed and completely empty: no checks, no reviews, no threads. There is nothing " +
          "in it to have satisfied anything.",
      ),
    };
  }
  return { providersObserved, staleReviews, result: gateSatisfied(evaluated) };
}

function describe(findings: readonly ReviewFinding[]): string {
  return findings.map((item) => `${item.rule} (${item.path}): ${item.message}`).join("; ");
}
