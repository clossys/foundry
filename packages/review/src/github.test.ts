import { describe, expect, it } from "vitest";
import { normalizeGitHubReviewEvidence } from "./github.js";
import { validateReviewEvidence } from "./validate.js";

const headSha = "c".repeat(40);

function page<T>(nodes: readonly T[], hasNextPage = false) {
  return { nodes, pageInfo: { hasNextPage } };
}

describe("normalizeGitHubReviewEvidence", () => {
  it("normalizes GitHub-shaped checks, reviews, and threads without provider I/O", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS" }]),
      reviews: page([
        { id: "review-approved", state: "APPROVED", commit: { oid: headSha } },
        { id: "review-dismissed", state: "DISMISSED", commit: { oid: headSha } },
      ]),
      reviewThreads: page([{ id: "thread-1", isResolved: true }]),
    });

    expect(evidence).toEqual({
      schemaVersion: 1,
      headSha,
      paginationComplete: true,
      checks: [{ name: "unit", conclusion: "success", headSha }],
      reviews: [
        { id: "review-approved", state: "approved", headSha },
        { id: "review-dismissed", state: "dismissed", headSha },
      ],
      threads: [{ id: "thread-1", isResolved: true, headSha }],
    });
    expect(validateReviewEvidence(evidence, { requiredChecks: ["unit"], requireApproval: true })).toEqual([]);
  });

  it("marks the bundle incomplete when any GitHub connection has another page", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS" }], true),
      reviews: page([]),
      reviewThreads: page([]),
    });

    expect(evidence.paginationComplete).toBe(false);
    expect(validateReviewEvidence(evidence, { requiredChecks: ["unit"], requireApproval: false }).map((entry) => entry.rule)).toEqual([
      "pagination-incomplete",
    ]);
  });

  it("preserves a stale review commit so root validation fails closed", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS" }]),
      reviews: page([{ id: "review-1", state: "APPROVED", commit_id: "d".repeat(40) }]),
      reviewThreads: page([]),
    });

    expect(validateReviewEvidence(evidence, { requiredChecks: ["unit"], requireApproval: true }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["stale-evidence", "reviews[0].headSha"],
      ["approval-missing", "reviews"],
    ]);
  });
});
