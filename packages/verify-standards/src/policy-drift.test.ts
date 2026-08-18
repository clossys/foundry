import { describe, expect, it } from "vitest";
import { gateResultToExitCode } from "@vespeneventures/governance/gates";
import { computeDigest } from "@vespeneventures/policy";
import { checkPolicyDrift } from "./policy-drift.js";
import type { PolicyDriftObservation } from "./policy-drift.js";

const strict = { allowUndeclaredLiveRequirements: false };

function observation(overrides: Partial<PolicyDriftObservation> = {}): PolicyDriftObservation {
  return {
    declaredRequirements: [{ id: "verify" }, { id: "secret-scan" }],
    liveRequirements: [{ id: "verify" }, { id: "secret-scan" }],
    liveSource: "an enforcement surface",
    liveComplete: true,
    ...overrides,
  };
}

describe("checkPolicyDrift", () => {
  it("is satisfied when the declared standard and the measured live state agree", () => {
    const report = checkPolicyDrift(observation(), strict);
    expect(report.result).toMatchObject({ verdict: "satisfied" });
    expect(report.compared).toBe(4);
    expect(gateResultToExitCode(report.result)).toBe(0);
  });

  it("is violated when a declared requirement is not actually enforced", () => {
    const report = checkPolicyDrift(observation({ liveRequirements: [{ id: "verify" }] }), strict);
    if (report.result.verdict !== "violated") throw new Error("expected violated");
    expect(report.result.findings.map((finding) => finding.rule)).toContain("requirement-missing");
    expect(gateResultToExitCode(report.result)).toBe(1);
  });

  it("is violated when something is enforced that nobody declared", () => {
    const report = checkPolicyDrift(
      observation({ liveRequirements: [{ id: "verify" }, { id: "secret-scan" }, { id: "surprise" }] }),
      strict,
    );
    if (report.result.verdict !== "violated") throw new Error("expected violated");
    expect(report.result.findings.map((finding) => finding.rule)).toContain("requirement-undeclared");
  });

  it("allows undeclared live requirements when the consuming repository chose to", () => {
    const report = checkPolicyDrift(
      observation({ liveRequirements: [{ id: "verify" }, { id: "secret-scan" }, { id: "extra" }] }),
      { allowUndeclaredLiveRequirements: true },
    );
    expect(report.result.verdict).toBe("satisfied");
  });

  describe("a declaration is never allowed to stand in for a measurement", () => {
    it("is indeterminate when the live state could not be read", () => {
      const report = checkPolicyDrift(observation({ liveRequirements: undefined }), strict);
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "live-state-unreadable" });
      expect(gateResultToExitCode(report.result)).toBe(2);
    });

    it("is indeterminate when the live read was only partial", () => {
      const report = checkPolicyDrift(observation({ liveComplete: false }), strict);
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "live-state-incomplete" });
    });

    it("is indeterminate when the live read's completeness was never stated", () => {
      const report = checkPolicyDrift(observation({ liveComplete: undefined }), strict);
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "live-state-incomplete" });
    });

    it("is indeterminate for an empty declaration, which any live state satisfies", () => {
      const report = checkPolicyDrift(observation({ declaredRequirements: [] }), strict);
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "empty-declaration" });
    });

    it("is indeterminate when no observation was supplied", () => {
      expect(checkPolicyDrift(undefined, strict).result).toMatchObject({ reason: "no-observation-supplied" });
    });
  });

  describe("content-addressed document drift", () => {
    const content = "the agreed policy text\n";
    const binding = { policyId: "a-policy", digestAlgorithm: "sha256" as const, digest: computeDigest(content) };

    it("is satisfied when a bound document still matches its digest", () => {
      const report = checkPolicyDrift(
        { declaredRequirements: [], documents: [{ binding, materializedContent: content }] },
        strict,
      );
      expect(report.result).toMatchObject({ verdict: "satisfied", evaluated: 1 });
    });

    it("is violated when the document's content has drifted", () => {
      const report = checkPolicyDrift(
        { declaredRequirements: [], documents: [{ binding, materializedContent: "something else\n" }] },
        strict,
      );
      if (report.result.verdict !== "violated") throw new Error("expected violated");
      expect(report.result.findings[0]?.rule).toBe("document-drifted");
    });

    it("is indeterminate when the bound document was never materialized", () => {
      const report = checkPolicyDrift({ declaredRequirements: [], documents: [{ binding }] }, strict);
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "document-not-materialized" });
    });

    it("is indeterminate when a binding is malformed", () => {
      const report = checkPolicyDrift(
        {
          declaredRequirements: [],
          documents: [
            {
              binding: { policyId: "", digestAlgorithm: "sha256", digest: "not-a-digest" },
              materializedContent: content,
            },
          ],
        },
        strict,
      );
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "binding-invalid" });
    });
  });

  it.each([[null], [42], ["a-string"]])("is indeterminate when a bound document entry is %s", (entry) => {
    const report = checkPolicyDrift(
      observation({ documents: [entry] as unknown as PolicyDriftObservation["documents"] }),
      strict,
    );
    expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "observation-malformed" });
    expect(gateResultToExitCode(report.result)).toBe(2);
  });

  it.each([
    ["declaredRequirements", { declaredRequirements: [null] }],
    ["declaredRequirements", { declaredRequirements: "not-a-list" }],
    ["liveRequirements", { liveRequirements: [{ detail: "no id here" }] }],
    ["documents", { documents: "not-a-list" }],
  ])("is indeterminate rather than throwing when %s is malformed", (_name, broken) => {
    const report = checkPolicyDrift(
      { ...observation(), ...broken } as unknown as PolicyDriftObservation,
      strict,
    );
    expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "observation-malformed" });
  });

  it.each([[undefined], [null], [{}], [{ allowUndeclaredLiveRequirements: "no" }]])(
    "is indeterminate when the options are %s",
    (broken) => {
      const report = checkPolicyDrift(observation(), broken as unknown as typeof strict);
      expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "no-options-supplied" });
      expect(gateResultToExitCode(report.result)).toBe(2);
    },
  );

  it("never reports satisfied on a path that evaluated nothing", () => {
    for (const input of [
      undefined,
      observation({ declaredRequirements: [] }),
      observation({ liveRequirements: undefined }),
      observation({ liveComplete: false }),
    ]) {
      expect(checkPolicyDrift(input, strict).result.verdict).not.toBe("satisfied");
    }
  });
});
