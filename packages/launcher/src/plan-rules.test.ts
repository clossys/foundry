import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateInventoryDocument } from "./core.js";
import { PLAN_CONTRACTS } from "./generated/plan-contracts.generated.js";
import { advisorPlanViolations, engagementBriefViolations, validateAdvisorPlan } from "./plan-contract.js";
import type { AdvisorPlan, DocumentViolation } from "./plan-contract.js";
import { planDigest } from "./plan-digest.js";

/*
 * Issue #1178: the plan and brief contracts' code rules (R1-R8, B1-B2),
 * defined once in the contracts' descriptions and implemented here
 * separately from @clossys/advisor. Both packages are tested against the one
 * corpus, docs/contracts/advisor-plan-rules.fixture.json, so they judge
 * every plan and brief alike. Reading the repository's docs here is
 * test-only: nothing at runtime leaves this package.
 */
interface Expected {
  rule: string;
  path: string;
}
interface RulesCorpus {
  plans: { name: string; plan: unknown; violations: Expected[] }[];
  briefs: { name: string; brief: unknown; violations: Expected[] }[];
}
const CORPUS = JSON.parse(readFileSync(new URL("../../../docs/contracts/advisor-plan-rules.fixture.json", import.meta.url), "utf8")) as RulesCorpus;

const asExpected = (violation: DocumentViolation): Expected => ({ rule: violation.rule, path: violation.path });
const sorted = (items: readonly Expected[]) => [...items].sort((left, right) => `${left.rule} ${left.path}`.localeCompare(`${right.rule} ${right.path}`));

/** The value at a corpus path such as `staffing[1].roles[0]`, or undefined when there is none. */
function at(document: unknown, path: string): unknown {
  let value = document;
  for (const segment of path.match(/[^.[\]]+/g) ?? []) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

describe("the shared rules corpus", () => {
  it("covers every code rule with at least one refused case, and has accepted cases for plans and briefs", () => {
    const rules = new Set([...CORPUS.plans, ...CORPUS.briefs].flatMap((entry) => entry.violations.map((violation) => violation.rule)));
    for (const rule of ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "B1", "B2", "schema"]) expect(rules, rule).toContain(rule);
    expect(CORPUS.plans.some((entry) => entry.violations.length === 0)).toBe(true);
    expect(CORPUS.briefs.some((entry) => entry.violations.length === 0)).toBe(true);
  });

  it("judges every corpus plan exactly as the corpus expects: the same rules at the same positions", () => {
    for (const entry of CORPUS.plans) expect(sorted(advisorPlanViolations(entry.plan).map(asExpected)), entry.name).toEqual(sorted(entry.violations));
  });

  it("judges every corpus brief exactly as the corpus expects", () => {
    for (const entry of CORPUS.briefs) expect(sorted(engagementBriefViolations(entry.brief).map(asExpected)), entry.name).toEqual(sorted(entry.violations));
  });

  it("never quotes the value at fault in a message, only its position", () => {
    const cases = [
      ...CORPUS.plans.map((entry) => ({ name: entry.name, document: entry.plan, violations: advisorPlanViolations(entry.plan) })),
      ...CORPUS.briefs.map((entry) => ({ name: entry.name, document: entry.brief, violations: engagementBriefViolations(entry.brief) })),
    ];
    for (const { name, document, violations } of cases) {
      for (const violation of violations) {
        const value = at(document, violation.path);
        expect(violation.message, name).toMatch(/^(?:plan|brief)[.[]/);
        if (typeof value === "string" && value.trim().length >= 4) expect(violation.message, name).not.toContain(value);
      }
    }
  });

  it("reports a code-rule refusal through validateAdvisorPlan, and gives it no digest", () => {
    const entry = CORPUS.plans.find((candidate) => candidate.name === "r6-packages-without-resolution")!;
    expect(validateAdvisorPlan(entry.plan)).toEqual({ valid: false, reason: "plan.resolution is required when packages is present (rule R6)" });
    expect(() => planDigest(entry.plan as AdvisorPlan)).toThrow(/invalid plan has no digest: plan.resolution is required/);
  });

  it("has a digest for every plan the corpus accepts", () => {
    for (const entry of CORPUS.plans.filter((candidate) => candidate.violations.length === 0)) expect(planDigest(entry.plan as AdvisorPlan), entry.name).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("the plan contract's repository id is the inventory's id rule (#1178)", () => {
  const definitions = PLAN_CONTRACTS["advisor-plan.json"]!.definitions as Record<string, { pattern: string }>;
  const pattern = new RegExp(definitions.repositoryId!.pattern, "u");
  const IDS = [
    "site", "example-owner/site", "Example-Owner/Site", "a/b", "owner/re.po_x-1", "owner/...", "o/.github", "a".repeat(39) + "/r",
    "", ".", "..", "owner/.", "owner/..", "./site", "owner/", "/site", "owner//site", "a/b/c", " site", "site ", "own er/site", "-owner/site", "owner-/site",
    "own--er/site", "a".repeat(40) + "/r", "owner/si te", "https://github.com/owner/site", "owner/site\n", "ownér/site",
  ];

  it("accepts exactly the ids validateInventoryDocument accepts", () => {
    for (const id of IDS) {
      const inventory = validateInventoryDocument(JSON.stringify({ schemaVersion: 1, repositories: [{ id }] }));
      expect(pattern.test(id), JSON.stringify(id)).toBe(inventory.valid);
    }
  });
});
