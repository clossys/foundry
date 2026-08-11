import { describe, expect, it } from "vitest";
import { normalizeGitHubReviewEvidence } from "./github.js";
import { validateReviewEvidence } from "./validate.js";

const headSha = "c".repeat(40);

function page<T>(nodes: readonly T[], hasNextPage = false, hasPreviousPage = false) {
  return { nodes, pageInfo: { hasNextPage, hasPreviousPage } };
}

describe("normalizeGitHubReviewEvidence", () => {
  it("normalizes GitHub-shaped checks, reviews, and threads without provider I/O", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
      reviews: page([
        { id: "review-approved", author: { login: "reviewer-1" }, submittedAt: "2026-01-01T00:00:00.000Z", state: "APPROVED", commit: { oid: headSha } },
        { id: "review-dismissed", author: { login: "reviewer-2" }, submittedAt: "2026-01-01T00:01:00.000Z", state: "DISMISSED", commit: { oid: headSha } },
      ]),
      reviewThreads: page([{ id: "thread-1", isResolved: true }]),
    });

    expect(evidence).toEqual({
      schemaVersion: 1,
      headSha,
      paginationComplete: true,
      checks: [{ name: "unit", conclusion: "success", headSha }],
      reviews: [
        { id: "review-approved", reviewerId: "reviewer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "approved", headSha },
        { id: "review-dismissed", reviewerId: "reviewer-2", submittedAt: "2026-01-01T00:01:00.000Z", state: "dismissed", headSha },
      ],
      threads: [{ id: "thread-1", isResolved: true, headSha }],
    });
    expect(validateReviewEvidence(evidence, { requiredChecks: ["unit"], requireApproval: true })).toEqual([]);
  });

  it("marks the bundle incomplete when any GitHub connection has another page", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }], true),
      reviews: page([]),
      reviewThreads: page([]),
    });

    expect(evidence.paginationComplete).toBe(false);
    expect(validateReviewEvidence(evidence, { requiredChecks: ["unit"], requireApproval: false }).map((entry) => entry.rule)).toEqual([
      "pagination-incomplete",
    ]);
  });

  it("marks the bundle incomplete when a GitHub connection has an earlier page", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }], false, true),
      reviews: page([]),
      reviewThreads: page([]),
    });

    expect(evidence.paginationComplete).toBe(false);
  });

  it("marks the bundle incomplete when a connection omits its node array", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
      reviews: page([]),
      reviewThreads: { pageInfo: { hasNextPage: false, hasPreviousPage: false } } as never,
    });

    expect(evidence.paginationComplete).toBe(false);
    expect(validateReviewEvidence(evidence, { requiredChecks: ["unit"], requireApproval: false }).map((entry) => entry.rule)).toEqual([
      "pagination-incomplete",
    ]);
  });

  it("omits unsubmitted pending GitHub reviews", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
      reviews: page([
        { id: "review-approved", author: { login: "reviewer-1" }, submittedAt: "2026-01-01T00:00:00.000Z", state: "APPROVED", commit: { oid: headSha } },
        { id: "review-pending", state: "PENDING" },
      ]),
      reviewThreads: page([]),
    });

    expect(evidence.reviews).toEqual([
      { id: "review-approved", reviewerId: "reviewer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "approved", headSha },
    ]);
    expect(validateReviewEvidence(evidence, { requiredChecks: ["unit"], requireApproval: true })).toEqual([]);
  });

  it("preserves a stale review commit so root validation fails closed", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
      reviews: page([{ id: "review-1", author: { login: "reviewer-1" }, submittedAt: "2026-01-01T00:00:00.000Z", state: "APPROVED", commit_id: "d".repeat(40) }]),
      reviewThreads: page([]),
    });

    expect(validateReviewEvidence(evidence, { requiredChecks: ["unit"], requireApproval: true }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["stale-evidence", "reviews[0].headSha"],
      ["approval-missing", "reviews"],
    ]);
  });

  it("does not stamp a check with the current head when provenance is absent", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS" }]),
      reviews: page([]),
      reviewThreads: page([]),
    });

    expect(evidence.checks[0]?.headSha).toBe("");
    expect(validateReviewEvidence(evidence, { requiredChecks: ["unit"], requireApproval: false }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["stale-evidence", "checks[0].headSha"],
      ["missing-required-check", "requiredChecks[0]"],
    ]);
  });

  it("does not stamp a review with the current head when commit provenance is absent", () => {
    const evidence = normalizeGitHubReviewEvidence({
      pullRequest: { id: "PR_node", headRefOid: headSha },
      checks: page([{ name: "unit", conclusion: "SUCCESS", headSha }]),
      reviews: page([{ id: "review-1", author: { login: "reviewer-1" }, submittedAt: "2026-01-01T00:00:00.000Z", state: "APPROVED" }]),
      reviewThreads: page([]),
    });

    expect(evidence.reviews[0]?.headSha).toBe("");
    expect(validateReviewEvidence(evidence, { requiredChecks: ["unit"], requireApproval: true }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["stale-evidence", "reviews[0].headSha"],
      ["approval-missing", "reviews"],
    ]);
  });
});
