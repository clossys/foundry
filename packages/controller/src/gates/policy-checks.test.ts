import { describe, expect, it } from "vitest";
import { computeDigest } from "../policy/index.js";
import type { PolicyBinding } from "../policy/index.js";
import { verifyPolicyBindings } from "./policy-checks.js";
import type { PolicyCheck } from "./types.js";

// Synthetic content only — two short fake strings, never anything resembling
// this repository's real denylist or any credential-shaped value.
const FIRST_CONTENT = "gates-fixture-document-one";
const SECOND_CONTENT = "gates-fixture-document-two";

function bindingFor(content: string): PolicyBinding {
  return { policyId: "irrelevant-for-shape", digestAlgorithm: "sha256", digest: computeDigest(content) };
}

describe("verifyPolicyBindings", () => {
  it("verifies multiple checks and attributes each result to its own policyId", () => {
    const checks: PolicyCheck[] = [
      { policyId: "doc-one", binding: bindingFor(FIRST_CONTENT), content: FIRST_CONTENT },
      { policyId: "doc-two", binding: bindingFor(SECOND_CONTENT), content: SECOND_CONTENT },
    ];

    const results = verifyPolicyBindings(checks);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ policyId: "doc-one", findings: [] });
    expect(results[1]).toEqual({ policyId: "doc-two", findings: [] });
  });

  it("reports a mismatch for a check whose content does not match its binding, alongside a passing one", () => {
    const checks: PolicyCheck[] = [
      { policyId: "passes", binding: bindingFor(FIRST_CONTENT), content: FIRST_CONTENT },
      // Bound to FIRST_CONTENT's digest but verified against different content.
      { policyId: "fails", binding: bindingFor(FIRST_CONTENT), content: SECOND_CONTENT },
    ];

    const results = verifyPolicyBindings(checks);

    expect(results).toHaveLength(2);

    const passing = results.find((r) => r.policyId === "passes");
    expect(passing?.findings).toEqual([]);

    const failing = results.find((r) => r.policyId === "fails");
    expect(failing?.findings).toHaveLength(1);
    expect(failing?.findings[0]?.rule).toBe("digest-mismatch");
  });

  it("reports a shape finding for a structurally malformed binding, still attributed correctly", () => {
    const malformed = { policyId: "", digestAlgorithm: "sha256", digest: "not-hex" } as unknown as PolicyBinding;
    const checks: PolicyCheck[] = [{ policyId: "malformed-check", binding: malformed, content: FIRST_CONTENT }];

    const results = verifyPolicyBindings(checks);

    expect(results).toHaveLength(1);
    expect(results[0]?.policyId).toBe("malformed-check");
    expect(results[0]?.findings.length).toBeGreaterThan(0);
    expect(results[0]?.findings.every((f) => f.severity === "error")).toBe(true);
  });

  it("returns an empty array for an empty checks list", () => {
    expect(verifyPolicyBindings([])).toEqual([]);
  });
});
