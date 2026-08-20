import { describe, expect, it } from "vitest";
import { normalizeGitHubReviewEvidence } from "./github.js";
import { validateReviewEvidence } from "./validate.js";

const headSha = "c".repeat(40);
const baseSha = "8".repeat(40);
const authoritativePolicy = { requiredChecks: ["unit"], requireApproval: true, requireSecondaryReview: false, decisionUse: "authoritative" };

function page<T>(nodes: readonly T[], hasNextPage = false, hasPreviousPage = false) {
  return { nodes, pageInfo: { hasNextPage, hasPreviousPage } };
}

describe("normalizeGitHubReviewEvidence", () => {
  it("normalizes GitHub-shaped checks, reviews, and threads without provider I/O", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
      reviews: page([
        { id: "review-approved", author: { login: "reviewer-1" }, provider: "analyzer-1", instanceId: "instance-1", depth: "primary", submittedAt: "2026-01-01T00:00:00.000Z", state: "APPROVED", commit: { oid: headSha } },
        { id: "review-dismissed", author: { login: "reviewer-2" }, provider: "analyzer-1", instanceId: "instance-2", depth: "primary", submittedAt: "2026-01-01T00:01:00.000Z", state: "DISMISSED", commit: { oid: headSha } },
      ]),
      reviewThreads: page([{ id: "thread-1", isResolved: true }]),
    });

    expect(evidence).toEqual({
      schemaVersion: 3,
      headSha,
      baseSha,
      paginationComplete: true,
      checks: [{ name: "unit", conclusion: "success", headSha }],
      reviews: [
        { id: "review-approved", reviewerId: "reviewer-1", instanceId: "instance-1", provider: "analyzer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "approved", depth: "primary", headSha },
        { id: "review-dismissed", reviewerId: "reviewer-2", instanceId: "instance-2", provider: "analyzer-1", submittedAt: "2026-01-01T00:01:00.000Z", state: "dismissed", depth: "primary", headSha },
      ],
      threads: [{ id: "thread-1", isResolved: true, headSha }],
    });
    expect(validateReviewEvidence(evidence, authoritativePolicy)).toEqual([]);
  });

  it("normalizes a bot- or app-authored review the same as a human's, since GitHub's Actor interface requires login on every author kind", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
      reviews: page([
        { id: "review-bot", author: { login: "some-review-bot" }, provider: "analyzer-1", instanceId: "instance-1", depth: "primary", submittedAt: "2026-01-01T00:00:00.000Z", state: "APPROVED", commit: { oid: headSha } },
      ]),
      reviewThreads: page([]),
    });

    expect(evidence.reviews).toEqual([
      { id: "review-bot", reviewerId: "some-review-bot", instanceId: "instance-1", provider: "analyzer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "approved", depth: "primary", headSha },
    ]);
    expect(validateReviewEvidence(evidence, authoritativePolicy)).toEqual([]);
  });

  it("reads baseSha from pullRequest.baseRefOid, independently of headSha", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
      checks: page([]),
      reviews: page([]),
      reviewThreads: page([]),
    });

    expect(evidence.headSha).toBe(headSha);
    expect(evidence.baseSha).toBe(baseSha);
    expect(evidence.baseSha).not.toBe(evidence.headSha);
  });

  it("does not invent a provider from the payload -- an omitted provider normalizes to empty and is rejected by validation, not guessed", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
      reviews: page([
        { id: "review-1", author: { login: "reviewer-1" }, instanceId: "instance-1", depth: "primary", submittedAt: "2026-01-01T00:00:00.000Z", state: "APPROVED", commit: { oid: headSha } },
      ]),
      reviewThreads: page([]),
    });

    expect(evidence.reviews[0]?.provider).toBe("");
    expect(validateReviewEvidence(evidence, authoritativePolicy).map((entry) => [entry.rule, entry.path])).toEqual([
      ["review-provider", "reviews[0].provider"],
    ]);
  });

  it("does not invent an instanceId or depth from the payload -- both normalize to empty and are rejected by validation, not guessed", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
      reviews: page([
        { id: "review-1", author: { login: "reviewer-1" }, provider: "analyzer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "APPROVED", commit: { oid: headSha } },
      ]),
      reviewThreads: page([]),
    });

    expect(evidence.reviews[0]?.instanceId).toBe("");
    expect(evidence.reviews[0]?.depth).toBe("");
    const rules = validateReviewEvidence(evidence, authoritativePolicy).map((entry) => entry.rule);
    expect(rules).toContain("review-instance-id");
    expect(rules).toContain("review-depth");
  });

  it("reads instanceId and depth only from what the caller already attached to the review node", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
      reviews: page([
        { id: "review-1", author: { login: "reviewer-1" }, provider: "analyzer-1", instanceId: "instance-1", depth: "secondary", submittedAt: "2026-01-01T00:00:00.000Z", state: "APPROVED", commit: { oid: headSha } },
      ]),
      reviewThreads: page([]),
    });

    expect(evidence.reviews[0]?.instanceId).toBe("instance-1");
    expect(evidence.reviews[0]?.depth).toBe("secondary");
    expect(validateReviewEvidence(evidence, authoritativePolicy)).toEqual([]);
  });

  it("reads patchId only from what the caller already attached to pullRequest, and omits it entirely otherwise", () => {
    const patchId = "d".repeat(40);
    const withPatchId = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha, patchId },
      checks: page([]),
      reviews: page([]),
      reviewThreads: page([]),
    });
    expect(withPatchId.patchId).toBe(patchId);

    const withoutPatchId = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
      checks: page([]),
      reviews: page([]),
      reviewThreads: page([]),
    });
    expect(withoutPatchId.patchId).toBeUndefined();
    expect("patchId" in withoutPatchId).toBe(false);

    const emptyPatchId = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha, patchId: "" },
      checks: page([]),
      reviews: page([]),
      reviewThreads: page([]),
    });
    expect("patchId" in emptyPatchId).toBe(false);
  });

  it("marks the bundle incomplete when any GitHub connection has another page", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }], true),
      reviews: page([]),
      reviewThreads: page([]),
    });

    expect(evidence.paginationComplete).toBe(false);
    // A required check's own verdict is indeterminate too while pagination
    // is incomplete, not just the bundle-wide finding -- see
    // ReviewFindingRule's "required-check-indeterminate" doc comment.
    expect(validateReviewEvidence(evidence, { requiredChecks: ["unit"], requireApproval: false, requireSecondaryReview: false, decisionUse: "authoritative" }).map((entry) => entry.rule)).toEqual([
      "pagination-incomplete",
      "required-check-indeterminate",
    ]);
  });

  it("marks the bundle incomplete when a GitHub connection has an earlier page", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }], false, true),
      reviews: page([]),
      reviewThreads: page([]),
    });

    expect(evidence.paginationComplete).toBe(false);
  });

  it("marks the bundle incomplete when a connection omits its node array", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
      reviews: page([]),
      reviewThreads: { pageInfo: { hasNextPage: false, hasPreviousPage: false } } as never,
    });

    expect(evidence.paginationComplete).toBe(false);
    expect(validateReviewEvidence(evidence, { requiredChecks: ["unit"], requireApproval: false, requireSecondaryReview: false, decisionUse: "authoritative" }).map((entry) => entry.rule)).toEqual([
      "pagination-incomplete",
      "required-check-indeterminate",
    ]);
  });

  it("omits unsubmitted pending GitHub reviews", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
      reviews: page([
        { id: "review-approved", author: { login: "reviewer-1" }, provider: "analyzer-1", instanceId: "instance-1", depth: "primary", submittedAt: "2026-01-01T00:00:00.000Z", state: "APPROVED", commit: { oid: headSha } },
        { id: "review-pending", state: "PENDING" },
      ]),
      reviewThreads: page([]),
    });

    expect(evidence.reviews).toEqual([
      { id: "review-approved", reviewerId: "reviewer-1", instanceId: "instance-1", provider: "analyzer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "approved", depth: "primary", headSha },
    ]);
    expect(validateReviewEvidence(evidence, authoritativePolicy)).toEqual([]);
  });

  it("marks sparse connection nodes incomplete instead of compacting them", () => {
    const sparseReviews = new Array(1) as Array<{
      id: string;
      state: string | null;
    }>;
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
      reviews: page(sparseReviews),
      reviewThreads: page([]),
    });

    expect(evidence.paginationComplete).toBe(false);
    expect(evidence.reviews).toEqual([]);
  });

  it.each([null, "NOT_A_GITHUB_REVIEW_STATE"]) (
    "keeps review evidence incomplete when review state is %j rather than silently omitting it",
    (state) => {
      const evidence = normalizeGitHubReviewEvidence({
        pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
        checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
        reviews: page([{ id: "review-invalid", state }]),
        reviewThreads: page([]),
      });

      expect(evidence.paginationComplete).toBe(false);
      expect(evidence.reviews).toEqual([{ id: "review-invalid", reviewerId: "", instanceId: "", provider: "", submittedAt: "", state: "unknown", depth: "", headSha: "" }]);
    },
  );

  it("preserves a stale review commit so root validation fails closed", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
      reviews: page([{ id: "review-1", author: { login: "reviewer-1" }, provider: "analyzer-1", instanceId: "instance-1", depth: "primary", submittedAt: "2026-01-01T00:00:00.000Z", state: "APPROVED", commit_id: "d".repeat(40) }]),
      reviewThreads: page([]),
    });

    expect(validateReviewEvidence(evidence, authoritativePolicy).map((entry) => [entry.rule, entry.path])).toEqual([
      ["stale-evidence", "reviews[0].headSha"],
      ["approval-missing", "reviews"],
    ]);
  });

  it("does not stamp a check with the current head when provenance is absent", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS" }]),
      reviews: page([]),
      reviewThreads: page([]),
    });

    expect(evidence.checks[0]?.headSha).toBe("");
    expect(validateReviewEvidence(evidence, { requiredChecks: ["unit"], requireApproval: false, requireSecondaryReview: false, decisionUse: "authoritative" }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["stale-evidence", "checks[0].headSha"],
      ["missing-required-check", "requiredChecks[0]"],
    ]);
  });

  it("does not stamp a review with the current head when commit provenance is absent", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
      reviews: page([{ id: "review-1", author: { login: "reviewer-1" }, provider: "analyzer-1", instanceId: "instance-1", depth: "primary", submittedAt: "2026-01-01T00:00:00.000Z", state: "APPROVED" }]),
      reviewThreads: page([]),
    });

    expect(evidence.reviews[0]?.headSha).toBe("");
    expect(validateReviewEvidence(evidence, authoritativePolicy).map((entry) => [entry.rule, entry.path])).toEqual([
      ["stale-evidence", "reviews[0].headSha"],
      ["approval-missing", "reviews"],
    ]);
  });

  describe("check completedAt (issue #391)", () => {
    it("reads completedAt from a camelCase GitHub check node", () => {
      const evidence = normalizeGitHubReviewEvidence({
        pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
        checks: page([{ name: "unit", conclusion: "SUCCESS", headSha, completedAt: "2026-08-18T21:23:36.000Z" } as never]),
        reviews: page([]),
        reviewThreads: page([]),
      });

      expect(evidence.checks[0]?.completedAt).toBe("2026-08-18T21:23:36.000Z");
      expect(validateReviewEvidence(evidence, authoritativePolicy).map((entry) => entry.rule)).not.toContain("check-completed-at");
    });

    it("reads completed_at from a snake_case GitHub check node, the same way head_sha already falls back for headSha", () => {
      const evidence = normalizeGitHubReviewEvidence({
        pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
        checks: page([{ name: "unit", conclusion: "SUCCESS", headSha, completed_at: "2026-08-18T21:23:36.000Z" } as never]),
        reviews: page([]),
        reviewThreads: page([]),
      });

      expect(evidence.checks[0]?.completedAt).toBe("2026-08-18T21:23:36.000Z");
    });

    it("omits completedAt entirely, rather than defaulting to an empty string, when the caller's node did not carry one -- a still-running check genuinely has none", () => {
      const evidence = normalizeGitHubReviewEvidence({
        pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
        checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
        reviews: page([]),
        reviewThreads: page([]),
      });

      expect(evidence.checks[0]?.completedAt).toBeUndefined();
      expect("completedAt" in evidence.checks[0]!).toBe(false);
      // A lone current-head run for a name never needs a timestamp to be
      // graded -- see ReviewCheck's own doc comment.
      expect(validateReviewEvidence(evidence, { requiredChecks: ["unit"], requireApproval: false, requireSecondaryReview: false, decisionUse: "authoritative" })).toEqual([]);
    });

    it("normalizes two runs of the same check name into two entries the evaluator can order by completedAt -- the exact collection shape issue #391 relies on", () => {
      const evidence = normalizeGitHubReviewEvidence({
        pullRequest: { id: "PR_node", headRefOid: headSha, baseRefOid: baseSha },
        checks: page([
          { name: "task-record", conclusion: "FAILURE", headSha, completedAt: "2026-08-18T21:00:00.000Z" } as never,
          { name: "task-record", conclusion: "SUCCESS", headSha, completedAt: "2026-08-18T21:23:36.000Z" } as never,
        ]),
        reviews: page([]),
        reviewThreads: page([]),
      });

      expect(evidence.checks).toHaveLength(2);
      expect(
        validateReviewEvidence(evidence, { requiredChecks: ["task-record"], requireApproval: false, requireSecondaryReview: false, decisionUse: "authoritative" }),
      ).toEqual([]);
    });
  });
});
