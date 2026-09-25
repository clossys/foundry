import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planDigest, validateAdvisorPlan, validateEngagementBrief } from "./index.js";
import type { AdvisorFinding, AdvisorPlan } from "./index.js";

/*
 * Issue #1178: the plan and brief contracts' code rules (R1-R10, B1-B2),
 * defined once in the contracts' descriptions and checked here against the
 * shared corpus docs/contracts/advisor-plan-rules.fixture.json.
 * @clossys/launcher implements the same rules separately and is tested
 * against the same file (its src/plan-rules.test.ts), so the two packages
 * judge every plan and brief alike.
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

/** A finding as the corpus writes it: "schema" for the contract's keywords, else the code rule's id. */
function asExpected(finding: AdvisorFinding): Expected {
  const rule = /^(?:advisor-plan|engagement-brief)-rule-([rb](?:10|[1-9]))$/.exec(finding.rule);
  if (rule) return { rule: rule[1]!.toUpperCase(), path: finding.path ?? "" };
  expect(["advisor-plan-contract", "engagement-brief-contract"]).toContain(finding.rule);
  return { rule: "schema", path: finding.path ?? "" };
}
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
    for (const rule of ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "B1", "B2", "schema"]) expect(rules, rule).toContain(rule);
    expect(CORPUS.plans.some((entry) => entry.violations.length === 0)).toBe(true);
    expect(CORPUS.briefs.some((entry) => entry.violations.length === 0)).toBe(true);
  });

  it("judges every corpus plan exactly as the corpus expects: the same rules at the same positions", () => {
    for (const entry of CORPUS.plans) expect(sorted(validateAdvisorPlan(entry.plan).map(asExpected)), entry.name).toEqual(sorted(entry.violations));
  });

  it("judges every corpus brief exactly as the corpus expects", () => {
    for (const entry of CORPUS.briefs) expect(sorted(validateEngagementBrief(entry.brief).map(asExpected)), entry.name).toEqual(sorted(entry.violations));
  });

  it("never quotes the value at fault in a message, only its position", () => {
    const cases = [
      ...CORPUS.plans.map((entry) => ({ name: entry.name, document: entry.plan, findings: validateAdvisorPlan(entry.plan) })),
      ...CORPUS.briefs.map((entry) => ({ name: entry.name, document: entry.brief, findings: validateEngagementBrief(entry.brief) })),
    ];
    for (const { name, document, findings } of cases) {
      for (const finding of findings) {
        const value = at(document, finding.path ?? "");
        expect(finding.message, name).toMatch(/^(?:plan|brief)[.[]/);
        if (typeof value === "string" && value.trim().length >= 4) expect(finding.message, name).not.toContain(value);
      }
    }
  });

  it("names the rule in a code-rule message, and gives a code-rule refusal no digest", () => {
    const entry = CORPUS.plans.find((candidate) => candidate.name === "r6-packages-without-resolution")!;
    expect(validateAdvisorPlan(entry.plan)).toEqual([
      { rule: "advisor-plan-rule-r6", severity: "error", message: "plan.resolution is required when packages is present (rule R6)", path: "resolution" },
    ]);
    expect(() => planDigest(entry.plan as AdvisorPlan)).toThrow(/invalid plan has no digest: plan.resolution is required/);
  });

  it("has a digest for every plan the corpus accepts", () => {
    for (const entry of CORPUS.plans.filter((candidate) => candidate.violations.length === 0)) expect(planDigest(entry.plan as AdvisorPlan), entry.name).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("inherited members are ignored, as the schema ignores them (#1178)", () => {
  // The same cases run in @clossys/launcher's plan-rules.test.ts, so both packages judge them alike.
  const corpusPlan = (name: string) => CORPUS.plans.find((entry) => entry.name === name)!.plan as Record<string, unknown>;
  const withPrototype = (prototype: object, own: Record<string, unknown>) => Object.assign(Object.create(prototype) as Record<string, unknown>, own);
  const full = corpusPlan("valid-staffed-with-packages");
  const bare = corpusPlan("valid-without-new-fields");
  const { resolution, ...withoutResolution } = full;

  it("accepts a plan whose staffing, packages, resolution and kits are only inherited", () => {
    const plan = withPrototype({ staffing: [], packages: [{}], resolution: {}, kits: [{}, {}] }, bare);
    expect(validateAdvisorPlan(plan)).toEqual([]);
  });

  it("does not count an inherited resolution as present (R6)", () => {
    const plan = withPrototype({ resolution }, withoutResolution);
    expect(sorted(validateAdvisorPlan(plan).map(asExpected))).toEqual([{ rule: "R6", path: "resolution" }]);
  });

  it("does not count an inherited packages as present (R6)", () => {
    const { packages, ...rest } = full;
    const plan = withPrototype({ packages }, rest);
    expect(sorted(validateAdvisorPlan(plan).map(asExpected))).toEqual([{ rule: "R6", path: "resolution" }]);
  });

  it("ignores an inherited staffedHere on a brief", () => {
    const brief = CORPUS.briefs.find((entry) => entry.name === "valid-hub-brief")!.brief as Record<string, unknown>;
    expect(validateEngagementBrief(withPrototype({ staffedHere: ["designer", "designer"] }, brief))).toEqual([]);
  });
});
