import { describe, expect, it } from "vitest";
import { NO_RULE_OPENED } from "./types.js";
import { selectRoles, validateOnboardingRequest } from "./selection.js";
import { activeRolesFromContract } from "./index.js";
import type { OnboardingRequest } from "./types.js";

const roles = activeRolesFromContract();
function request(overrides: Partial<OnboardingRequest> = {}): OnboardingRequest {
  return { schemaVersion: 1, engagement: { id: "engagement-alpha", decisionOwner: "decision-owner-alpha" }, unresolved: [], unmapped: [], candidateRoles: [], ...overrides };
}
function selected(value: OnboardingRequest): string[] {
  return selectRoles(value, roles).filter((item) => item.outcome === "selected").map((item) => item.role);
}

describe("first-day role selection", () => {
  it("opens the engagement baseline and the independent outcome role for every engagement", () => {
    expect(selected(request())).toEqual(["@clossys/advisor", "@clossys/observer"]);
  });

  it("opens the direction role only when a direction subject is declared unresolved", () => {
    expect(selected(request())).not.toContain("@clossys/strategist");
    expect(selected(request({ unresolved: ["causal-metric-tree"] }))).toContain("@clossys/strategist");
  });

  it("opens the operating-system role only when an architecture subject is declared unmapped", () => {
    expect(selected(request())).not.toContain("@clossys/architect");
    expect(selected(request({ unmapped: ["repository-topology"] }))).toContain("@clossys/architect");
  });

  it("opens a consumer-requested operating role and records which rule opened it", () => {
    const result = selectRoles(request({ candidateRoles: ["@clossys/messenger"] }), roles);
    expect(result.find((item) => item.role === "@clossys/messenger")).toEqual({ role: "@clossys/messenger", outcome: "selected", rule: "consumer-requested" });
  });

  it("dispositions every active role exactly once and gives every exclusion the same single reason", () => {
    const result = selectRoles(request(), roles);
    expect(result.map((item) => item.role)).toEqual([...roles].sort());
    expect(new Set(result.filter((item) => item.outcome === "excluded").map((item) => item.rule))).toEqual(new Set([NO_RULE_OPENED]));
  });

  it("is a pure function of declared facts: the same request always selects the same roles", () => {
    const value = request({ unresolved: ["business-model", "northstars"], unmapped: ["ontology"], candidateRoles: ["@clossys/bouncer"] });
    expect(JSON.stringify(selectRoles(value, roles))).toEqual(JSON.stringify(selectRoles(value, roles)));
  });

  it("refuses a request whose declared subjects are not in the fixed vocabulary", () => {
    const findings = validateOnboardingRequest({ ...request(), unresolved: ["everything-feels-unclear"] });
    expect(findings.map((item) => item.rule)).toContain("invalid-unresolved-subjects");
  });

  it("refuses a request missing an accountable decision owner", () => {
    const findings = validateOnboardingRequest({ ...request(), engagement: { id: "engagement-alpha", decisionOwner: "  " } });
    expect(findings.map((item) => item.rule)).toContain("invalid-engagement");
  });
});
