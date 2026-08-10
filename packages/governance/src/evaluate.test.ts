import { describe, expect, it } from "vitest";
import { evaluatePullRequestGovernance } from "./evaluate.js";
import type { PullRequestGovernanceInput, TenantGovernancePolicy } from "./types.js";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);

function policy(overrides: Partial<TenantGovernancePolicy> = {}): TenantGovernancePolicy {
  return {
    checkName: "governance-advisory",
    checkTitle: "Governance advisory",
    requiredReviewerLogin: "review-bot",
    ownerLogins: ["owner"],
    sensitivePathPatterns: ["^\.github/", "^infra/"],
    ...overrides,
  };
}

function input(overrides: Partial<PullRequestGovernanceInput> = {}): PullRequestGovernanceInput {
  return {
    repository: "example/repository",
    pullRequestNumber: 7,
    baseSha,
    headSha,
    changedFileCount: 1,
    changedFiles: ["src/feature.ts"],
    review: {
      reviewedHeadSha: headSha,
      submittedAt: "2026-01-01T00:00:00Z",
      reviewerLogin: "review-bot",
      latestState: "COMMENTED",
      latestStateChangingState: "APPROVED",
      inlineFindingCount: 0,
      unresolvedThreadCount: 0,
    },
    ...overrides,
  };
}

describe("evaluatePullRequestGovernance", () => {
  it("returns a successful App-owned check payload for complete exact-head evidence", () => {
    const result = evaluatePullRequestGovernance(input(), policy());
    expect(result.findings).toEqual([]);
    expect(result.check).toMatchObject({ name: "governance-advisory", headSha, status: "completed", conclusion: "success" });
  });

  it("fails closed when changed-file enumeration is incomplete", () => {
    const result = evaluatePullRequestGovernance(input({ changedFileCount: 2 }), policy());
    expect(result.findings.map((finding) => finding.rule)).toContain("changed-files-complete");
    expect(result.check.conclusion).toBe("failure");
  });

  it("fails closed on a dismissed state-changing review even with a later comment", () => {
    const result = evaluatePullRequestGovernance(input({ review: { ...input().review!, latestState: "COMMENTED", latestStateChangingState: "DISMISSED" } }), policy());
    expect(result.findings.map((finding) => finding.rule)).toContain("review-state");
  });

  it("requires evidence from the configured reviewer", () => {
    const result = evaluatePullRequestGovernance(input({ review: { ...input().review!, reviewerLogin: "other-reviewer" } }), policy());
    expect(result.findings.map((finding) => finding.rule)).toContain("reviewer-identity");
  });

  it("requires a post-review acknowledgement for sensitive paths", () => {
    const sensitive = input({ changedFiles: [".github/workflows/check.yml"] });
    const withoutAcknowledgement = evaluatePullRequestGovernance(sensitive, policy());
    expect(withoutAcknowledgement.findings.map((finding) => finding.rule)).toContain("sensitive-change-acknowledgement");
    const withAcknowledgement = evaluatePullRequestGovernance({ ...sensitive, acknowledgement: { login: "owner", headSha, createdAt: "2026-01-01T00:00:01Z" } }, policy());
    expect(withAcknowledgement.findings).toEqual([]);
  });

  it("does not accept an acknowledgement for a different head or an earlier review time", () => {
    const result = evaluatePullRequestGovernance(input({ changedFiles: ["infra/config.ts"], acknowledgement: { login: "owner", headSha: baseSha, createdAt: "2025-12-31T23:59:59Z" } }), policy());
    expect(result.findings.map((finding) => finding.rule)).toContain("sensitive-change-acknowledgement");
  });

  it("reports invalid injected policy patterns without leaking their content", () => {
    const result = evaluatePullRequestGovernance(input(), policy({ sensitivePathPatterns: ["["] }));
    expect(result.findings).toContainEqual({ rule: "policy-pattern-valid", message: "A tenant policy contains an invalid sensitive-path pattern." });
  });
});
