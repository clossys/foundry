import { describe, expect, it } from "vitest";
import {
  isReviewEvidenceBundle,
  isReviewPolicyAdoptionState,
  isReviewPolicyCoverageState,
  validateReviewEvidence,
  validateReviewPolicy,
} from "./index.js";

const headSha = "a".repeat(40);
const baseSha = "9".repeat(40);
const policy = { requiredChecks: ["unit"], requireApproval: true, decisionUse: "authoritative" };

function validEvidence() {
  return {
    schemaVersion: 2,
    headSha,
    baseSha,
    paginationComplete: true,
    checks: [{ name: "unit", conclusion: "success", headSha }],
    reviews: [{ id: "review-1", reviewerId: "reviewer-1", provider: "analyzer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "approved", headSha }],
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
    evidence.reviews.push({ id: "review-2", reviewerId: "reviewer-2", provider: "analyzer-1", submittedAt: "2026-01-01T00:01:00.000Z", state: "dismissed", headSha });
    expect(validateReviewEvidence(evidence, policy)).toEqual([]);
  });

  it("does not treat a dismissed change request as blocking", () => {
    const evidence = validEvidence();
    evidence.reviews = [{ id: "review-2", reviewerId: "reviewer-2", provider: "analyzer-1", submittedAt: "2026-01-01T00:01:00.000Z", state: "dismissed", headSha }];
    expect(validateReviewEvidence(evidence, { requiredChecks: ["unit"], requireApproval: false, decisionUse: "authoritative" })).toEqual([]);
  });

  it("reports malformed policy values deterministically", () => {
    expect(validateReviewPolicy({ requiredChecks: ["unit", "unit", ""], requireApproval: "yes" }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["duplicate-required-check", "requiredChecks[1]"],
      ["required-check-name", "requiredChecks[2]"],
      ["require-approval", "requireApproval"],
      ["decision-use", "decisionUse"],
    ]);
  });

  it("allows a consumer to require neither checks nor approval", () => {
    expect(validateReviewPolicy({ requiredChecks: [], requireApproval: false, decisionUse: "authoritative" })).toEqual([]);
    const evidence = validEvidence();
    evidence.checks = [];
    evidence.reviews = [];
    expect(validateReviewEvidence(evidence, { requiredChecks: [], requireApproval: false, decisionUse: "authoritative" })).toEqual([]);
    expect(isReviewEvidenceBundle(evidence)).toBe(true);
  });

  it("uses each reviewer's latest current-head decision", () => {
    const evidence = validEvidence();
    evidence.reviews = [
      { id: "review-1", reviewerId: "reviewer-1", provider: "analyzer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "changes-requested", headSha },
      { id: "review-2", reviewerId: "reviewer-1", provider: "analyzer-1", submittedAt: "2026-01-01T00:01:00.000Z", state: "approved", headSha },
    ];
    expect(validateReviewEvidence(evidence, policy)).toEqual([]);
  });

  it("does not let a later comment-only review clear a change request", () => {
    const evidence = validEvidence();
    evidence.reviews = [
      { id: "review-1", reviewerId: "reviewer-1", provider: "analyzer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "changes-requested", headSha },
      { id: "review-2", reviewerId: "reviewer-1", provider: "analyzer-1", submittedAt: "2026-01-01T00:01:00.000Z", state: "commented", headSha },
      { id: "review-3", reviewerId: "reviewer-2", provider: "analyzer-1", submittedAt: "2026-01-01T00:02:00.000Z", state: "approved", headSha },
    ];
    expect(validateReviewEvidence(evidence, policy).map((entry) => entry.rule)).toEqual(["changes-requested"]);
  });

  it("fails closed for tied conflicting decisive review decisions", () => {
    const evidence = validEvidence();
    evidence.reviews = [
      { id: "review-1", reviewerId: "reviewer-1", provider: "analyzer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "changes-requested", headSha },
      { id: "review-2", reviewerId: "reviewer-1", provider: "analyzer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "approved", headSha },
    ];
    expect(validateReviewEvidence(evidence, policy).map((entry) => entry.rule)).toEqual([
      "approval-missing",
      "changes-requested",
      "review-decision-ambiguous",
    ]);
    expect(isReviewEvidenceBundle(evidence)).toBe(true);
  });

  it("lets a later decisive review supersede older timestamp ambiguity", () => {
    const evidence = validEvidence();
    evidence.reviews = [
      { id: "review-1", reviewerId: "reviewer-1", provider: "analyzer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "changes-requested", headSha },
      { id: "review-2", reviewerId: "reviewer-1", provider: "analyzer-1", submittedAt: "2026-01-01T00:00:00.000Z", state: "approved", headSha },
      { id: "review-3", reviewerId: "reviewer-1", provider: "analyzer-1", submittedAt: "2026-01-01T00:01:00.000Z", state: "approved", headSha },
    ];
    expect(validateReviewEvidence(evidence, policy)).toEqual([]);
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

  it("rejects a baseSha exposed only through an accessor, same as headSha", () => {
    const accessorEvidence = validEvidence();
    Object.defineProperty(accessorEvidence, "baseSha", { enumerable: true, get: () => baseSha });
    expect(validateReviewEvidence(accessorEvidence, policy).map((entry) => entry.rule)).toEqual(["evidence-shape"]);
  });

  it("does not read a provider spoofed through a polluted Object.prototype -- only the review's own property counts", () => {
    Object.defineProperty(Object.prototype, "provider", { value: "spoofed-provider", configurable: true });
    try {
      const evidence = validEvidence();
      delete (evidence.reviews[0] as { provider?: string }).provider;
      // Sanity check: the review record itself does inherit the polluted
      // value through the prototype chain...
      expect((evidence.reviews[0] as Record<string, unknown>).provider).toBe("spoofed-provider");
      // ...but validation must still report it missing, because ownData only
      // ever reads an own property descriptor, never an inherited one.
      expect(validateReviewEvidence(evidence, policy).map((entry) => entry.rule)).toContain("review-provider");
    } finally {
      delete (Object.prototype as Record<string, unknown>).provider;
    }
  });

  describe("decisionUse", () => {
    it("rejects a missing or unsupported decisionUse", () => {
      expect(validateReviewPolicy({ requiredChecks: [], requireApproval: false }).map((entry) => entry.rule)).toEqual(["decision-use"]);
      expect(validateReviewPolicy({ requiredChecks: [], requireApproval: false, decisionUse: "informational" }).map((entry) => entry.rule)).toEqual(["decision-use"]);
      expect(validateReviewPolicy({ requiredChecks: [], requireApproval: false, decisionUse: null }).map((entry) => entry.rule)).toEqual(["decision-use"]);
    });

    it("rejects requireApproval: true under an advisory decisionUse at policy-validation time, before evidence is read", () => {
      const advisoryPolicy = { requiredChecks: [], requireApproval: true, decisionUse: "advisory" };
      expect(validateReviewPolicy(advisoryPolicy).map((entry) => [entry.rule, entry.path])).toEqual([
        ["advisory-approval-conflict", "requireApproval"],
      ]);
      // The same rejection applies through validateReviewEvidence, and it
      // does not also report "approval-missing" on top of the conflict --
      // the policy is already invalid, so there is nothing more to add.
      const evidence = validEvidence();
      evidence.reviews = [];
      expect(validateReviewEvidence(evidence, advisoryPolicy).map((entry) => entry.rule)).toEqual(["advisory-approval-conflict"]);
    });

    it("accepts an advisory policy that never requires approval", () => {
      const advisoryPolicy = { requiredChecks: ["unit"], requireApproval: false, decisionUse: "advisory" };
      expect(validateReviewPolicy(advisoryPolicy)).toEqual([]);
      const evidence = validEvidence();
      expect(validateReviewEvidence(evidence, advisoryPolicy)).toEqual([]);
    });

    it("accepts an authoritative policy that does require approval", () => {
      expect(validateReviewPolicy({ requiredChecks: [], requireApproval: true, decisionUse: "authoritative" })).toEqual([]);
    });
  });

  describe("baseSha", () => {
    it("rejects a missing or malformed baseSha", () => {
      const evidence = validEvidence();
      delete (evidence as { baseSha?: string }).baseSha;
      expect(validateReviewEvidence(evidence, policy).map((entry) => entry.rule)).toContain("base-sha");

      const badEvidence = validEvidence();
      badEvidence.baseSha = "not-a-sha";
      expect(validateReviewEvidence(badEvidence, policy).map((entry) => entry.rule)).toContain("base-sha");

      const upperCaseEvidence = validEvidence();
      upperCaseEvidence.baseSha = "B".repeat(40);
      expect(validateReviewEvidence(upperCaseEvidence, policy).map((entry) => entry.rule)).toContain("base-sha");
    });

    it("accepts a bundle whose baseSha differs from its headSha", () => {
      const evidence = validEvidence();
      expect(evidence.baseSha).not.toBe(evidence.headSha);
      expect(validateReviewEvidence(evidence, policy)).toEqual([]);
    });
  });

  describe("schema version", () => {
    it("rejects a version-1 bundle explicitly, with a finding naming the version problem, rather than coercing or accepting it", () => {
      const v1Evidence = {
        schemaVersion: 1,
        headSha,
        paginationComplete: true,
        checks: [{ name: "unit", conclusion: "success", headSha }],
        reviews: [],
        threads: [],
      };
      const findings = validateReviewEvidence(v1Evidence, policy);
      const schemaFinding = findings.find((entry) => entry.rule === "schema-version");
      expect(schemaFinding).toBeDefined();
      expect(schemaFinding?.message).toContain("1");
      expect(schemaFinding?.message.toLowerCase()).toContain("base");
      // A rejected version-1 bundle must never be treated as though it were
      // a valid version-2 bundle just because it happens to lack baseSha --
      // baseSha is separately, and also, reported invalid.
      expect(findings.map((entry) => entry.rule)).toContain("base-sha");
    });
  });

  describe("provider", () => {
    it("requires each review to declare a non-empty provider", () => {
      const evidence = validEvidence();
      evidence.reviews[0]!.provider = "";
      expect(validateReviewEvidence(evidence, policy).map((entry) => [entry.rule, entry.path])).toEqual([
        ["review-provider", "reviews[0].provider"],
      ]);
    });

    it("rejects a missing provider rather than defaulting it silently", () => {
      const evidence = validEvidence();
      delete (evidence.reviews[0] as { provider?: string }).provider;
      expect(validateReviewEvidence(evidence, policy).map((entry) => entry.rule)).toContain("review-provider");
    });

    it("does not constrain provider to any known vendor -- any non-empty opaque string is accepted", () => {
      const evidence = validEvidence();
      evidence.reviews[0]!.provider = "some-other-analyzer";
      expect(validateReviewEvidence(evidence, policy)).toEqual([]);
    });
  });

  describe("adoption and coverage vocabulary", () => {
    it("accepts only the three declared adoption states", () => {
      expect(isReviewPolicyAdoptionState("adopted")).toBe(true);
      expect(isReviewPolicyAdoptionState("not-adopted")).toBe(true);
      expect(isReviewPolicyAdoptionState("assessment-pending")).toBe(true);
      expect(isReviewPolicyAdoptionState("pending")).toBe(false);
      expect(isReviewPolicyAdoptionState("gap")).toBe(false);
      expect(isReviewPolicyAdoptionState("")).toBe(false);
      expect(isReviewPolicyAdoptionState(undefined)).toBe(false);
      expect(isReviewPolicyAdoptionState(null)).toBe(false);
      expect(isReviewPolicyAdoptionState(1)).toBe(false);
    });

    it("accepts only the three declared coverage states", () => {
      expect(isReviewPolicyCoverageState("verified")).toBe(true);
      expect(isReviewPolicyCoverageState("not-verified")).toBe(true);
      expect(isReviewPolicyCoverageState("assessment-pending")).toBe(true);
      expect(isReviewPolicyCoverageState("gap")).toBe(false);
      expect(isReviewPolicyCoverageState("")).toBe(false);
      expect(isReviewPolicyCoverageState(undefined)).toBe(false);
      expect(isReviewPolicyCoverageState(null)).toBe(false);
      expect(isReviewPolicyCoverageState(1)).toBe(false);
    });

    it("never lets an adoption value satisfy a coverage requirement, or a coverage value satisfy adoption -- coverage cannot be satisfied by adoption alone", () => {
      // "adopted" and "not-adopted" are pass/fail adoption values; neither is
      // a valid coverage value, so a caller cannot make a policy "covered"
      // merely by supplying the fact that it was adopted.
      expect(isReviewPolicyCoverageState("adopted")).toBe(false);
      expect(isReviewPolicyCoverageState("not-adopted")).toBe(false);
      // Symmetrically, "verified"/"not-verified" are not adoption values.
      expect(isReviewPolicyAdoptionState("verified")).toBe(false);
      expect(isReviewPolicyAdoptionState("not-verified")).toBe(false);
      // The only value both vocabularies share is the explicit "not yet
      // assessed" third state, and accepting it in one dimension asserts
      // nothing about the other dimension either way.
      expect(isReviewPolicyAdoptionState("assessment-pending")).toBe(true);
      expect(isReviewPolicyCoverageState("assessment-pending")).toBe(true);
    });
  });
});
