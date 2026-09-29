import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COPY_DELEGATE_SCOPE_RE } from "./approval.js";
import { ADVISOR_PLAN_CONTRACT } from "./generated/advisor-plan-contract.generated.js";
import { assertImplementedContract } from "./generated/contract-schema.generated.js";
import { planViolations } from "./plan-contract.js";

/*
 * Issue #1586. The plan contract this package packs at build time, and the
 * one contract checker it carries a copy of, checked against the shared
 * files in the source repository. Reading sibling source here is test-only:
 * nothing at runtime leaves this package.
 */
const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");

interface RulesCorpus {
  plans: { name: string; plan: unknown; violations: { rule: string; path: string }[] }[];
}
const RULES = JSON.parse(read("docs/contracts/advisor-plan-rules.fixture.json")) as RulesCorpus;
const corpusPlan = (name: string): unknown => RULES.plans.find((entry) => entry.name === name)!.plan;

describe("the packed plan contract", () => {
  it("is docs/contracts/advisor-plan.json, unchanged", () => {
    expect(ADVISOR_PLAN_CONTRACT).toEqual(JSON.parse(read("docs/contracts/advisor-plan.json")));
  });

  it("uses only keywords the checker implements, in every subschema", () => {
    expect(() => assertImplementedContract(ADVISOR_PLAN_CONTRACT)).not.toThrow();
  });

  it("carries a byte-identical copy of Advisor's one contract checker, under a generated-file header", () => {
    const copy = readFileSync(new URL("./generated/contract-schema.generated.ts", import.meta.url), "utf8");
    const canonical = read("packages/advisor/src/contract-schema.ts");
    expect(copy.startsWith("// AUTO-GENERATED")).toBe(true);
    expect(copy.endsWith(canonical)).toBe(true);
    expect(copy.slice(0, copy.length - canonical.length).split("\n").every((line) => line === "" || line.startsWith("//"))).toBe(true);
  });

  it("declares the delegate scope pattern this package's registry validation uses, character for character", () => {
    const definitions = ADVISOR_PLAN_CONTRACT.definitions as Record<string, { pattern?: string; properties?: Record<string, { enum?: unknown }> }>;
    expect(definitions.copyDelegateScope?.pattern).toBe(COPY_DELEGATE_SCOPE_RE.source);
  });

  it("declares one delegated copy approval target, production", () => {
    const definitions = ADVISOR_PLAN_CONTRACT.definitions as Record<string, { properties?: Record<string, { enum?: unknown }> }>;
    expect(definitions.delegatedCopyApproval?.properties?.target?.enum).toEqual(["production"]);
  });
});

describe("planViolations", () => {
  const valid = corpusPlan("valid-delegated-copy-approval-scoped");

  it("is empty for a valid plan", () => {
    expect(planViolations(valid)).toEqual([]);
  });

  it("reports a schema failure by position, in the checker's wording, and runs no code rule after it", () => {
    const plan = { ...(valid as Record<string, unknown>), delegatedCopyApproval: { target: "production", scopes: ["home", "Pricing"] } };
    expect(planViolations(plan)).toEqual([
      { rule: "schema", path: "delegatedCopyApproval.scopes[1]", message: expect.stringMatching(/^plan\.delegatedCopyApproval\.scopes\[1\] must be a copy entry-id namespace/) },
    ]);
  });

  it("reports a code-rule failure with its rule id and position, never a value", () => {
    const base = valid as { mandate: { roles: string[] } };
    const plan = { ...base, mandate: { ...base.mandate, roles: [...base.mandate.roles, base.mandate.roles[0]!] } };
    const found = planViolations(plan);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rule: "R9" });
    expect(found[0]?.message).toMatch(/^plan\.mandate\.roles\[\d+\] repeats mandate\.roles\[0\] \(rule R9\)$/);
  });

  it("refuses a value that is not an object, without throwing", () => {
    for (const value of [undefined, null, 5, "plan", []]) {
      const found = planViolations(value);
      expect(found.length, String(value)).toBeGreaterThan(0);
      expect(found.every((violation) => violation.rule === "schema")).toBe(true);
    }
  });
});
