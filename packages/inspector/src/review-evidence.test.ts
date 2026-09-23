import { describe, expect, it } from "vitest";
import { gateResultToExitCode } from "@clossys/controller/gates";
import { REVIEW_EVIDENCE_VERSION } from "@clossys/controller/review";
import type { ReviewEvidenceBundle, ReviewPolicy } from "@clossys/controller/review";
import { checkReviewEvidence } from "./review-evidence.js";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);

const policy: ReviewPolicy = {
  requiredChecks: ["verify"],
  requireApproval: false,
  requireSecondaryReview: false,
  decisionUse: "advisory",
};

function evidence(overrides: Partial<ReviewEvidenceBundle> = {}): ReviewEvidenceBundle {
  return {
    schemaVersion: REVIEW_EVIDENCE_VERSION,
    headSha: HEAD,
    baseSha: BASE,
    paginationComplete: true,
    checks: [{ name: "verify", conclusion: "success", headSha: HEAD }],
    reviews: [
      {
        id: "REVIEW_1",
        reviewerId: "a-reviewer",
        instanceId: "SESSION_1",
        provider: "a-review-client",
        submittedAt: "2026-08-17T10:00:00Z",
        state: "approved",
        depth: "primary",
        headSha: HEAD,
      },
    ],
    threads: [{ id: "THREAD_1", isResolved: true, headSha: HEAD }],
    ...overrides,
  };
}

const options = { requireReviewPresence: true, headShaUnderTest: HEAD };

// Merge-train head: what a review record submitted against an EARLIER push
// carries as its own `headSha`. Never equal to HEAD.
const STALE_HEAD = "c".repeat(40);

// `requireApproval` cannot be tested under the default advisory `policy`
// above — `decisionUse: "advisory"` makes `requireApproval: true` a rejected,
// self-contradictory policy (see validateReviewPolicy's own
// "advisory-approval-conflict" rule). Needed only for the "stale approval
// never counts" / "current approval still counts" cases below.
const authoritativePolicy: ReviewPolicy = {
  requiredChecks: [],
  requireApproval: true,
  requireSecondaryReview: false,
  decisionUse: "authoritative",
};

function staleCommentedReview(overrides: Partial<ReviewEvidenceBundle["reviews"][number]> = {}) {
  return {
    id: "REVIEW_STALE",
    reviewerId: "coderabbitai",
    instanceId: "coderabbitai",
    provider: "github",
    submittedAt: "2026-08-17T09:00:00Z",
    state: "commented" as const,
    depth: "primary" as const,
    headSha: STALE_HEAD,
    ...overrides,
  };
}

describe("checkReviewEvidence", () => {
  it("is satisfied for complete evidence that meets the policy", () => {
    const report = checkReviewEvidence(evidence(), policy, options);
    expect(report.result).toMatchObject({ verdict: "satisfied", evaluated: 3 });
    expect(report.providersObserved).toEqual(["a-review-client"]);
    expect(gateResultToExitCode(report.result)).toBe(0);
  });

  it("is violated when a required check failed", () => {
    const report = checkReviewEvidence(
      evidence({ checks: [{ name: "verify", conclusion: "failure", headSha: HEAD }] }),
      policy,
      options,
    );
    expect(report.result.verdict).toBe("violated");
    expect(gateResultToExitCode(report.result)).toBe(1);
    if (report.result.verdict !== "violated") throw new Error("unreachable");
    expect(report.result.findings.map((finding) => finding.rule)).toContain("required-check-failed");
  });

  it("is violated when a thread is still unresolved", () => {
    const report = checkReviewEvidence(
      evidence({ threads: [{ id: "THREAD_1", isResolved: false, headSha: HEAD }] }),
      policy,
      options,
    );
    if (report.result.verdict !== "violated") throw new Error("expected violated");
    expect(report.result.findings.map((finding) => finding.rule)).toContain("unresolved-thread");
  });

  it("is violated when presence is required and nobody reviewed at head", () => {
    const report = checkReviewEvidence(evidence({ reviews: [] }), policy, options);
    if (report.result.verdict !== "violated") throw new Error("expected violated");
    expect(report.result.findings.map((finding) => finding.rule)).toContain("review-presence-missing");
  });

  it("does not demand presence when the consuming repository did not ask for it", () => {
    const report = checkReviewEvidence(evidence({ reviews: [] }), policy, {
      requireReviewPresence: false,
      headShaUnderTest: HEAD,
    });
    expect(report.result.verdict).toBe("satisfied");
  });

  describe("evaluability is kept apart from verdict", () => {
    it("reports an incompletely-read bundle as indeterminate, not as a failed review", () => {
      // `validateReviewEvidence` reports this through the same error channel
      // it reports a real violation through. Folding them together would
      // label an incomplete read as a reviewer's decision.
      const report = checkReviewEvidence(evidence({ paginationComplete: false }), policy, options);
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "evidence-incomplete" });
      expect(gateResultToExitCode(report.result)).toBe(2);
    });

    it("reports a malformed bundle as indeterminate", () => {
      const report = checkReviewEvidence({ schemaVersion: 1, headSha: HEAD }, policy, options);
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "evidence-malformed" });
    });

    it("reports an empty but well-formed bundle as indeterminate, never satisfied", () => {
      const report = checkReviewEvidence(
        evidence({ checks: [], reviews: [], threads: [] }),
        { ...policy, requiredChecks: [] },
        { requireReviewPresence: false },
      );
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "evidence-incomplete" });
    });

    it("reports an invalid policy as indeterminate rather than failing the change", () => {
      const report = checkReviewEvidence(evidence(), { ...policy, decisionUse: "whatever" }, options);
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "policy-invalid" });
    });

    it("reports evidence bound to a different head as indeterminate", () => {
      const report = checkReviewEvidence(evidence(), policy, {
        requireReviewPresence: true,
        headShaUnderTest: "c".repeat(40),
      });
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "evidence-head-mismatch" });
    });

    it("declines when evidence or policy is missing entirely", () => {
      expect(checkReviewEvidence(undefined, policy, options).result).toMatchObject({
        reason: "no-evidence-supplied",
      });
      expect(checkReviewEvidence(evidence(), undefined, options).result).toMatchObject({
        reason: "no-policy-supplied",
      });
    });

    it("still reports indeterminate for a stale CHECK — the carve-out is reviews-only", () => {
      // A check stamped with a head other than the bundle's own means the
      // bundle disagrees with itself; that stays a genuine evaluability
      // problem even after the review-specific carve-out below.
      const report = checkReviewEvidence(
        evidence({ checks: [{ name: "verify", conclusion: "success", headSha: STALE_HEAD }] }),
        policy,
        options,
      );
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "evidence-malformed" });
    });

    it("still reports indeterminate for a stale THREAD — the carve-out is reviews-only", () => {
      const report = checkReviewEvidence(
        evidence({ threads: [{ id: "THREAD_1", isResolved: true, headSha: STALE_HEAD }] }),
        policy,
        options,
      );
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "evidence-malformed" });
    });
  });

  describe("a stale review record is excluded from the verdict, not folded into indeterminate (#1187, #1297, #1302)", () => {
    it("no longer blocks review-evidence when the only review is a stale bot COMMENTED review left behind by a merge-train push", () => {
      // The exact reproduction: CodeRabbit, rate-limited, left one COMMENTED
      // review at an earlier head and cannot re-review. Before this change,
      // that review's own "stale-evidence" finding forced the whole check to
      // indeterminate forever — worse than a PR with no review at all, which
      // passes cleanly.
      const report = checkReviewEvidence(
        evidence({ reviews: [staleCommentedReview()] }),
        policy,
        { requireReviewPresence: false, headShaUnderTest: HEAD },
      );
      expect(report.result.verdict).toBe("satisfied");
      expect(gateResultToExitCode(report.result)).toBe(0);
      expect(report.staleReviews).toHaveLength(1);
      expect(report.staleReviews[0]).toMatchObject({ rule: "stale-evidence", path: "reviews[0].headSha" });
    });

    it("still requires presence when the only review is stale and presence is required", () => {
      // The carve-out changes only whether the check can ANSWER; it must not
      // quietly satisfy a repository's own requireReviewPresence requirement
      // with a review that predates the current head.
      const report = checkReviewEvidence(
        evidence({ reviews: [staleCommentedReview()] }),
        policy,
        { requireReviewPresence: true, headShaUnderTest: HEAD },
      );
      expect(report.result.verdict).toBe("violated");
      if (report.result.verdict !== "violated") throw new Error("unreachable");
      expect(report.result.findings.map((finding) => finding.rule)).toContain("review-presence-missing");
    });

    it("never lets a stale approval satisfy requireApproval", () => {
      const report = checkReviewEvidence(
        evidence({
          checks: [],
          threads: [],
          reviews: [staleCommentedReview({ id: "REVIEW_STALE_APPROVAL", state: "approved" })],
        }),
        authoritativePolicy,
        { requireReviewPresence: false, headShaUnderTest: HEAD },
      );
      expect(report.result.verdict).toBe("violated");
      if (report.result.verdict !== "violated") throw new Error("unreachable");
      expect(report.result.findings.map((finding) => finding.rule)).toContain("approval-missing");
      expect(report.staleReviews).toHaveLength(1);
    });

    it("still counts a current-head approval", () => {
      const report = checkReviewEvidence(
        evidence({
          checks: [],
          threads: [],
          reviews: [
            {
              id: "REVIEW_CURRENT_APPROVAL",
              reviewerId: "a-reviewer",
              instanceId: "SESSION_CURRENT",
              provider: "a-review-client",
              submittedAt: "2026-08-17T10:00:00Z",
              state: "approved",
              depth: "primary",
              headSha: HEAD,
            },
          ],
        }),
        authoritativePolicy,
        { requireReviewPresence: false, headShaUnderTest: HEAD },
      );
      expect(report.result.verdict).toBe("satisfied");
      expect(report.staleReviews).toHaveLength(0);
    });

    it("still fails on a current-head changes-requested review even alongside a stale one", () => {
      const report = checkReviewEvidence(
        evidence({
          checks: [],
          threads: [],
          reviews: [
            staleCommentedReview(),
            {
              id: "REVIEW_CURRENT_CHANGES",
              reviewerId: "a-reviewer",
              instanceId: "SESSION_CURRENT",
              provider: "a-review-client",
              submittedAt: "2026-08-17T10:00:00Z",
              state: "changes-requested",
              depth: "primary",
              headSha: HEAD,
            },
          ],
        }),
        policy,
        { requireReviewPresence: false, headShaUnderTest: HEAD },
      );
      expect(report.result.verdict).toBe("violated");
      if (report.result.verdict !== "violated") throw new Error("unreachable");
      expect(report.result.findings.map((finding) => finding.rule)).toContain("changes-requested");
      expect(report.staleReviews).toHaveLength(1);
    });
  });

  describe("a stale objection is not the same as a stale comment or a stale approval (second opinion on #1311)", () => {
    const noRequiredChecksPolicy = { ...policy, requiredChecks: [] };

    it("still fails when a reviewer's own LATEST decisive review requested changes at a stale head", () => {
      // A push must not be able to silently clear a human reviewer's own
      // objection just by existing. Only that reviewer's later dismissal or a
      // newer decisive review can supersede it.
      const report = checkReviewEvidence(
        evidence({
          checks: [],
          threads: [],
          reviews: [
            {
              id: "REVIEW_STALE_CHANGES",
              reviewerId: "a-human-reviewer",
              instanceId: "SESSION_HUMAN",
              provider: "a-review-client",
              submittedAt: "2026-08-17T09:00:00Z",
              state: "changes-requested",
              depth: "primary",
              headSha: STALE_HEAD,
            },
          ],
        }),
        noRequiredChecksPolicy,
        { requireReviewPresence: false, headShaUnderTest: HEAD },
      );
      expect(report.result.verdict).toBe("violated");
      if (report.result.verdict !== "violated") throw new Error("unreachable");
      expect(report.result.findings.map((finding) => finding.rule)).toContain("stale-changes-requested");
      // Carve-out and violation are separate facts about the same record: it
      // is still reported as excluded from evaluability too.
      expect(report.staleReviews).toHaveLength(1);
    });

    it("a stale changes-requested is NOT cleared by that same reviewer's later COMMENTED review — only a decisive record supersedes it", () => {
      const report = checkReviewEvidence(
        evidence({
          checks: [],
          threads: [],
          reviews: [
            {
              id: "REVIEW_STALE_CHANGES",
              reviewerId: "a-human-reviewer",
              instanceId: "SESSION_HUMAN",
              provider: "a-review-client",
              submittedAt: "2026-08-17T09:00:00Z",
              state: "changes-requested",
              depth: "primary",
              headSha: STALE_HEAD,
            },
            {
              id: "REVIEW_LATER_COMMENT",
              reviewerId: "a-human-reviewer",
              instanceId: "SESSION_HUMAN",
              provider: "a-review-client",
              submittedAt: "2026-08-17T11:00:00Z",
              state: "commented",
              depth: "primary",
              headSha: HEAD,
            },
          ],
        }),
        noRequiredChecksPolicy,
        { requireReviewPresence: false, headShaUnderTest: HEAD },
      );
      expect(report.result.verdict).toBe("violated");
      if (report.result.verdict !== "violated") throw new Error("unreachable");
      expect(report.result.findings.map((finding) => finding.rule)).toContain("stale-changes-requested");
    });

    it("a stale changes-requested IS cleared once that same reviewer approves at the current head", () => {
      const report = checkReviewEvidence(
        evidence({
          checks: [],
          threads: [],
          reviews: [
            {
              id: "REVIEW_STALE_CHANGES",
              reviewerId: "a-human-reviewer",
              instanceId: "SESSION_HUMAN",
              provider: "a-review-client",
              submittedAt: "2026-08-17T09:00:00Z",
              state: "changes-requested",
              depth: "primary",
              headSha: STALE_HEAD,
            },
            {
              id: "REVIEW_LATER_APPROVAL",
              reviewerId: "a-human-reviewer",
              instanceId: "SESSION_HUMAN",
              provider: "a-review-client",
              submittedAt: "2026-08-17T11:00:00Z",
              state: "approved",
              depth: "primary",
              headSha: HEAD,
            },
          ],
        }),
        noRequiredChecksPolicy,
        { requireReviewPresence: false, headShaUnderTest: HEAD },
      );
      expect(report.result.verdict).toBe("satisfied");
    });

    it.each([
      ["stale changes-requested listed first, current approval second", true],
      ["current approval listed first, stale changes-requested second", false],
    ])(
      "a same-reviewer tie between a stale changes-requested and a current approval is ambiguous, never decided by array order (%s)",
      (_label, changesRequestedFirst) => {
        // Opus's re-review finding: `submittedAtMs >= previous.submittedAtMs`
        // let a tie fall to whichever array entry was read last, so the SAME
        // two records failed open or closed depending only on their order.
        // validateReviews (@clossys/controller/review/validate) already
        // refuses to invent an order for an equal-timestamp, different-state
        // tie at the current head -- "review-decision-ambiguous" -- and this
        // function must agree, across heads, regardless of array order.
        const stale = {
          id: "REVIEW_TIE_STALE_CHANGES",
          reviewerId: "a-human-reviewer",
          instanceId: "SESSION_HUMAN",
          provider: "a-review-client",
          submittedAt: "2026-08-17T09:00:00Z",
          state: "changes-requested" as const,
          depth: "primary" as const,
          headSha: STALE_HEAD,
        };
        const current = {
          id: "REVIEW_TIE_CURRENT_APPROVAL",
          reviewerId: "a-human-reviewer",
          instanceId: "SESSION_HUMAN",
          provider: "a-review-client",
          submittedAt: "2026-08-17T09:00:00Z",
          state: "approved" as const,
          depth: "primary" as const,
          headSha: HEAD,
        };
        const report = checkReviewEvidence(
          evidence({
            checks: [],
            threads: [],
            reviews: changesRequestedFirst ? [stale, current] : [current, stale],
          }),
          noRequiredChecksPolicy,
          { requireReviewPresence: false, headShaUnderTest: HEAD },
        );
        expect(report.result.verdict).toBe("violated");
        if (report.result.verdict !== "violated") throw new Error("unreachable");
        expect(report.result.findings.map((finding) => finding.rule)).toContain("review-decision-ambiguous");
      },
    );

    it("reports a review with no recorded commit as indeterminate — unknown, not stale", () => {
      // scripts/collect-review-evidence.mjs writes an empty headSha when
      // GitHub's own payload carries no commit.oid. That is a different fact
      // from "submitted against an earlier commit" and must not be carved
      // out on the strength of a path match alone.
      const report = checkReviewEvidence(
        evidence({
          reviews: [
            {
              id: "REVIEW_NO_COMMIT",
              reviewerId: "a-reviewer",
              instanceId: "SESSION_NO_COMMIT",
              provider: "a-review-client",
              submittedAt: "2026-08-17T09:00:00Z",
              state: "commented",
              depth: "primary",
              headSha: "",
            },
          ],
        }),
        policy,
        { requireReviewPresence: false, headShaUnderTest: HEAD },
      );
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "evidence-malformed" });
      expect(report.staleReviews).toHaveLength(0);
    });

    it("treats a bundle whose only reviews are stale exactly like an empty bundle — indeterminate when presence is not required", () => {
      const report = checkReviewEvidence(
        evidence({ checks: [], threads: [], reviews: [staleCommentedReview()] }),
        noRequiredChecksPolicy,
        { requireReviewPresence: false, headShaUnderTest: HEAD },
      );
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "evidence-incomplete" });
    });

    it("treats a bundle whose only reviews are stale exactly like an empty bundle — violated on review-presence-missing when presence is required", () => {
      const report = checkReviewEvidence(
        evidence({ checks: [], threads: [], reviews: [staleCommentedReview()] }),
        noRequiredChecksPolicy,
        { requireReviewPresence: true, headShaUnderTest: HEAD },
      );
      expect(report.result.verdict).toBe("violated");
      if (report.result.verdict !== "violated") throw new Error("unreachable");
      expect(report.result.findings.map((finding) => finding.rule)).toContain("review-presence-missing");
    });
  });

  it.each([[undefined], [null], [{}], [{ requireReviewPresence: "yes" }]])(
    "is indeterminate when the options are %s",
    (broken) => {
      // `requireReviewPresence` has no default. Reading an absent one as
      // `false` would be this package choosing a consuming repository's
      // review policy and then reporting the result as the repository's own.
      const report = checkReviewEvidence(evidence(), policy, broken as unknown as typeof options);
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "no-options-supplied" });
      expect(gateResultToExitCode(report.result)).toBe(2);
    },
  );

  it("is indeterminate when headShaUnderTest is supplied and is not a string", () => {
    const report = checkReviewEvidence(evidence(), policy, {
      requireReviewPresence: true,
      headShaUnderTest: 7,
    } as unknown as typeof options);
    expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "no-options-supplied" });
  });

  it("never reports satisfied on a path that evaluated nothing", () => {
    for (const bundle of [undefined, {}, evidence({ paginationComplete: false })]) {
      expect(checkReviewEvidence(bundle, policy, options).result.verdict).not.toBe("satisfied");
    }
  });
});
