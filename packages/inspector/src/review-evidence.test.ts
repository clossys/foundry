import { describe, expect, it } from "vitest";
import { gateResultToExitCode } from "@vespeneventures/controller/gates";
import { REVIEW_EVIDENCE_VERSION } from "@vespeneventures/controller/review";
import type { ReviewEvidenceBundle, ReviewPolicy } from "@vespeneventures/controller/review";
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
