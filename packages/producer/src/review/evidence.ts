/**
 * The exact-head evidence adapter for `clossys review plan`: the head a unit is planned at comes from
 * @clossys/controller's review evidence (normalizeGitHubReviewEvidence over a caller-saved GitHub snapshot, then
 * isReviewEvidenceBundle), never from a reviewer's word. No network access: the snapshot is a file the caller saved.
 */
import { isReviewEvidenceBundle, validateReviewEvidence, type ReviewEvidenceBundle } from "@clossys/controller/review";
import { normalizeGitHubReviewEvidence, type GitHubReviewEvidencePayload } from "@clossys/controller/review/github";

const DECISION_RULES = new Set(["changes-requested", "unresolved-thread", "review-decision-ambiguous"]);

export interface ExactHead {
  readonly headSha: string;
  readonly baseSha: string;
  /** False when the snapshot had another page: such evidence never stands for the head. */
  readonly complete: boolean;
}

/** The head and base a saved GitHub review snapshot (or an already normalized bundle) states. */
export function exactHeadEvidence(value: unknown): ExactHead {
  const bundle: ReviewEvidenceBundle = isReviewEvidenceBundle(value) ? value : normalizeGitHubReviewEvidence(value as GitHubReviewEvidencePayload);
  // The decision rules (a live objection) are not this adapter's to judge; every shape finding is.
  const shape = validateReviewEvidence(bundle, { requiredChecks: [], requireApproval: false, requireSecondaryReview: false, decisionUse: "authoritative" })
    .filter(finding => !DECISION_RULES.has(finding.rule));
  if (shape.length) throw new Error(`the review evidence does not stand for a head: ${[...new Set(shape.map(finding => finding.rule))].join(", ")}`);
  return { headSha: bundle.headSha, baseSha: bundle.baseSha, complete: bundle.paginationComplete };
}

/** Throws unless the evidence is complete and names exactly this head. */
export function assertExactHead(evidence: ExactHead, head: string): void {
  if (!evidence.complete) throw new Error("the review evidence is incomplete (a collection had another page): it does not stand for the head");
  if (evidence.headSha !== head) throw new Error(`the review evidence is for ${evidence.headSha || "no head"}, not the exact head ${head}`);
}
