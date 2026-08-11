import { describe, expect, it } from "vitest";
import { isReviewEvidenceBundle, validateReviewEvidence, validateReviewPolicy } from "./index.js";

const headSha = "a".repeat(40);
const policy = { requiredChecks: ["unit"], requireApproval: true };

function validEvidence() {
  return {
    schemaVersion: 1,
    headSha,
    paginationComplete: true,
    checks: [{ name: "unit", conclusion: "success", headSha }],
    reviews: [{ id: "review-1", state: "approved", headSha }],
    threads: [{ id: "thread-1", isResolved: true, headSha }],
  };
}

describe("validateReviewEvidence", () => {
  it("accepts complete current-head evidence that satisfies a policy", () => {
    expect(validateReviewEvidence(validEvidence(), policy)).toEqual([]);
    expect(isReviewEvidenceBundle(validEvidence())).toBe(true);
  });

  it("fails closed when evidence was observed for a stale head", () => {
    const evidence = validEvidence();
    evidence.checks[0]!.headSha = "b".repeat(40);
    expect(validateReviewEvidence(evidence, policy).map((entry) => [entry.rule, entry.path])).toEqual([
      ["stale-evidence", "checks[0].headSha"],
      ["missing-required-check", "requiredChecks[0]"],
    ]);
  });

  it("fails closed when a GitHub collection has another page", () => {
    const evidence = validEvidence();
    evidence.paginationComplete = false;
    expect(validateReviewEvidence(evidence, policy).map((entry) => entry.rule)).toEqual(["pagination-incomplete"]);
  });

  it("reports unresolved threads and failed required checks", () => {
    const evidence = validEvidence();
    evidence.checks[0]!.conclusion = "failure";
    evidence.threads[0]!.isResolved = false;
    expect(validateReviewEvidence(evidence, policy).map((entry) => [entry.rule, entry.path])).toEqual([
      ["unresolved-thread", "threads[0]"],
      ["required-check-failed", "requiredChecks[0]"],
    ]);
  });

  it("ignores a dismissed decision while retaining current approvals", () => {
    const evidence = validEvidence();
    evidence.reviews.push({ id: "review-2", state: "dismissed", headSha });
    expect(validateReviewEvidence(evidence, policy)).toEqual([]);
  });

  it("does not treat a dismissed change request as blocking", () => {
    const evidence = validEvidence();
    evidence.reviews = [{ id: "review-2", state: "dismissed", headSha }];
    expect(validateReviewEvidence(evidence, { requiredChecks: ["unit"], requireApproval: false })).toEqual([]);
  });

  it("reports malformed policy values deterministically", () => {
    expect(validateReviewPolicy({ requiredChecks: ["unit", "unit", ""], requireApproval: "yes" }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["duplicate-required-check", "requiredChecks[1]"],
      ["required-check-name", "requiredChecks[2]"],
      ["require-approval", "requireApproval"],
    ]);
  });

  it("allows a consumer to require neither checks nor approval", () => {
    expect(validateReviewPolicy({ requiredChecks: [], requireApproval: false })).toEqual([]);
    const evidence = validEvidence();
    evidence.checks = [];
    evidence.reviews = [];
    expect(validateReviewEvidence(evidence, { requiredChecks: [], requireApproval: false })).toEqual([]);
    expect(isReviewEvidenceBundle(evidence)).toBe(true);
  });
});
