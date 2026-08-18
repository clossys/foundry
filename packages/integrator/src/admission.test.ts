import { describe, expect, it } from "vitest";
import { evaluateAdmission, loadAdmissionContract, type AdmissionContext } from "./admission.js";
import { IntegratorValidationError } from "./errors.js";
import type { EntitlementDeclaration } from "./entitlement.js";
import type { ReachabilityVerdict } from "./reachability.js";

function context(entitlements: string[], optOuts: string[] = [], reachability: Record<string, ReachabilityVerdict> = {}): AdmissionContext {
  const declaration: EntitlementDeclaration = {
    version: 1,
    entitlements: entitlements.map((name) => ({ name })),
    optOuts: optOuts.map((name) => ({ name, reason: "test" })),
  };
  return { declaration, reachability: new Map(Object.entries(reachability)) };
}

describe("loadAdmissionContract", () => {
  it("normalizes a valid contract", () => {
    const contract = loadAdmissionContract({ version: 1, rules: [{ kind: "must-be-entitled" }, { kind: "minimum-version", floor: "1.0.0" }] });
    expect(contract.rules).toEqual([{ kind: "must-be-entitled" }, { kind: "minimum-version", floor: "1.0.0" }]);
  });

  it("rejects an unknown rule kind", () => {
    expect(() => loadAdmissionContract({ version: 1, rules: [{ kind: "not-a-real-rule" }] })).toThrow(IntegratorValidationError);
  });

  it("rejects a duplicate rule kind", () => {
    expect(() => loadAdmissionContract({ version: 1, rules: [{ kind: "must-be-entitled" }, { kind: "must-be-entitled" }] })).toThrow(/more than once/);
  });

  it("rejects a minimum-version rule with an unparseable floor", () => {
    expect(() => loadAdmissionContract({ version: 1, rules: [{ kind: "minimum-version", floor: "not-a-version" }] })).toThrow(IntegratorValidationError);
  });
});

describe("evaluateAdmission", () => {
  it("admits a candidate that satisfies every rule -- empty findings", () => {
    const contract = loadAdmissionContract({
      version: 1,
      rules: [{ kind: "must-be-entitled" }, { kind: "must-not-be-opted-out" }, { kind: "requires-known-reachability" }, { kind: "minimum-version", floor: "1.0.0" }],
    });
    const findings = evaluateAdmission(
      contract,
      { name: "@example-scope/one", version: "1.2.0" },
      context(["@example-scope/one"], [], { "@example-scope/one": { kind: "known", latestVersion: "1.2.0" } }),
    );
    expect(findings).toEqual([]);
  });

  it("finds a candidate not present in the entitlement declaration", () => {
    const contract = loadAdmissionContract({ version: 1, rules: [{ kind: "must-be-entitled" }] });
    const findings = evaluateAdmission(contract, { name: "@example-scope/other", version: "1.0.0" }, context(["@example-scope/one"]));
    expect(findings).toEqual([{ rule: "must-be-entitled", message: "@example-scope/other is not in the entitlement declaration" }]);
  });

  it("finds a candidate with a recorded opt-out", () => {
    const contract = loadAdmissionContract({ version: 1, rules: [{ kind: "must-not-be-opted-out" }] });
    const findings = evaluateAdmission(contract, { name: "@example-scope/one", version: "1.0.0" }, context(["@example-scope/one"], ["@example-scope/one"]));
    expect(findings).toEqual([{ rule: "must-not-be-opted-out", message: "@example-scope/one has a recorded opt-out" }]);
  });

  it("finds a candidate with no confirmed reachable registry entry", () => {
    const contract = loadAdmissionContract({ version: 1, rules: [{ kind: "requires-known-reachability" }] });
    const unauth = evaluateAdmission(contract, { name: "a", version: "1.0.0" }, context(["a"], [], { a: { kind: "unauthenticated" } }));
    expect(unauth).toHaveLength(1);
    const unprobed = evaluateAdmission(contract, { name: "a", version: "1.0.0" }, context(["a"]));
    expect(unprobed).toHaveLength(1);
  });

  it("finds a candidate below the minimum-version floor", () => {
    const contract = loadAdmissionContract({ version: 1, rules: [{ kind: "minimum-version", floor: "2.0.0" }] });
    const findings = evaluateAdmission(contract, { name: "a", version: "1.9.9" }, context(["a"]));
    expect(findings).toEqual([{ rule: "minimum-version", message: "a@1.9.9 is below the required floor 2.0.0" }]);
  });

  it("reports every failing rule, not just the first", () => {
    const contract = loadAdmissionContract({
      version: 1,
      rules: [{ kind: "must-be-entitled" }, { kind: "must-not-be-opted-out" }],
    });
    const findings = evaluateAdmission(contract, { name: "a", version: "1.0.0" }, context([], ["a"]));
    expect(findings.map((f) => f.rule)).toEqual(["must-be-entitled", "must-not-be-opted-out"]);
  });

  it("rejects an invalid candidate name up front", () => {
    const contract = loadAdmissionContract({ version: 1, rules: [] });
    const findings = evaluateAdmission(contract, { name: "Not Valid", version: "1.0.0" }, context([]));
    expect(findings).toHaveLength(1);
  });
});
