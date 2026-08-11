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
    reviews: [{ id: "review-1", reviewerId: "reviewer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "approved", headSha }],
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
    evidence.reviews.push({ id: "review-2", reviewerId: "reviewer-2", submittedAt: "2026-01-01T00:01:00.000Z", state: "dismissed", headSha });
    expect(validateReviewEvidence(evidence, policy)).toEqual([]);
  });

  it("does not treat a dismissed change request as blocking", () => {
    const evidence = validEvidence();
    evidence.reviews = [{ id: "review-2", reviewerId: "reviewer-2", submittedAt: "2026-01-01T00:01:00.000Z", state: "dismissed", headSha }];
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

  it("uses each reviewer's latest current-head decision", () => {
    const evidence = validEvidence();
    evidence.reviews = [
      { id: "review-1", reviewerId: "reviewer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "changes-requested", headSha },
      { id: "review-2", reviewerId: "reviewer-1", submittedAt: "2026-01-01T00:01:00.000Z", state: "approved", headSha },
    ];
    expect(validateReviewEvidence(evidence, policy)).toEqual([]);
  });

  it("does not let a later comment-only review clear a change request", () => {
    const evidence = validEvidence();
    evidence.reviews = [
      { id: "review-1", reviewerId: "reviewer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "changes-requested", headSha },
      { id: "review-2", reviewerId: "reviewer-1", submittedAt: "2026-01-01T00:01:00.000Z", state: "commented", headSha },
      { id: "review-3", reviewerId: "reviewer-2", submittedAt: "2026-01-01T00:02:00.000Z", state: "approved", headSha },
    ];
    expect(validateReviewEvidence(evidence, policy).map((entry) => entry.rule)).toEqual(["changes-requested"]);
  });

  it("fails closed for tied conflicting decisive review decisions", () => {
    const evidence = validEvidence();
    evidence.reviews = [
      { id: "review-1", reviewerId: "reviewer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "changes-requested", headSha },
      { id: "review-2", reviewerId: "reviewer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "approved", headSha },
    ];
    expect(validateReviewEvidence(evidence, policy).map((entry) => entry.rule)).toEqual([
      "approval-missing",
      "changes-requested",
      "review-decision-ambiguous",
    ]);
  });

  it("recognizes structurally valid negative evidence", () => {
    const evidence = validEvidence();
    evidence.reviews[0]!.state = "changes-requested";
    evidence.threads[0]!.isResolved = false;
    expect(isReviewEvidenceBundle(evidence)).toBe(true);
    expect(validateReviewEvidence(evidence, policy).map((entry) => entry.rule)).toEqual([
      "unresolved-thread",
      "approval-missing",
      "changes-requested",
    ]);
  });

  it("requires timezone-qualified timestamps before ordering reviewer decisions", () => {
    const evidence = validEvidence();
    evidence.reviews[0]!.submittedAt = "2026-03-08T02:30:00";
    expect(validateReviewEvidence(evidence, policy).map((entry) => [entry.rule, entry.path])).toEqual([
      ["review-submitted-at", "reviews[0].submittedAt"],
      ["approval-missing", "reviews"],
    ]);
  });

  it("rejects review timestamps more precise than milliseconds", () => {
    const evidence = validEvidence();
    evidence.reviews[0]!.submittedAt = "2026-01-01T00:00:00.0001Z";
    expect(validateReviewEvidence(evidence, policy).map((entry) => [entry.rule, entry.path])).toEqual([
      ["review-submitted-at", "reviews[0].submittedAt"],
      ["approval-missing", "reviews"],
    ]);
  });

  it("rejects inherited, accessor, and sparse evidence before it can satisfy policy", () => {
    expect(validateReviewEvidence(Object.create(validEvidence()), policy).map((entry) => entry.rule)).toEqual(["evidence-shape"]);

    const accessorEvidence = validEvidence();
    Object.defineProperty(accessorEvidence, "headSha", { enumerable: true, get: () => headSha });
    expect(validateReviewEvidence(accessorEvidence, policy).map((entry) => entry.rule)).toEqual(["evidence-shape"]);

    const sparseEvidence = validEvidence();
    sparseEvidence.checks = new Array(1);
    expect(validateReviewEvidence(sparseEvidence, policy).map((entry) => [entry.rule, entry.path])).toEqual([
      ["checks-shape", "checks"],
      ["missing-required-check", "requiredChecks[0]"],
    ]);

    const oversizedEvidence = validEvidence();
    oversizedEvidence.checks = new Array(10_001);
    expect(validateReviewEvidence(oversizedEvidence, policy).map((entry) => entry.rule)).toContain("checks-shape");
  });
});
