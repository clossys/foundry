import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADVISOR_PLAN_CONTRACT } from "./generated/advisor-plan-contract.generated.js";
import { planViolations } from "./plan-contract.js";
import type { PlanViolation } from "./plan-contract.js";
import { HUB_ONLY_ROLES } from "./plan-rules.js";

/*
 * Issue #1586: this package's own implementation of the plan contract's code
 * rules R1-R12, written from the contract's description and tested against
 * the shared rules corpus every other reader of a plan is tested against.
 * Writer reads no brief, so it runs only the plan cases. Reading the
 * repository's docs here is test-only: nothing at runtime leaves this package.
 */
interface Expected {
  rule: string;
  path: string;
}
interface RulesCorpus {
  plans: { name: string; plan: unknown; violations: Expected[] }[];
}
const CORPUS = JSON.parse(readFileSync(new URL("../../../docs/contracts/advisor-plan-rules.fixture.json", import.meta.url), "utf8")) as RulesCorpus;

const asExpected = (violation: PlanViolation): Expected => ({ rule: violation.rule, path: violation.path });
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
  it("refuses at least one case under each of schema and R1 to R12, and under no other rule", () => {
    const rules = new Set(CORPUS.plans.flatMap((entry) => entry.violations.map((violation) => violation.rule)));
    expect([...rules].sort()).toEqual(["R1", "R10", "R11", "R12", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "schema"]);
    expect(CORPUS.plans.some((entry) => entry.violations.length === 0)).toBe(true);
  });

  it("judges every corpus plan exactly as the corpus expects: the same rules at the same positions", () => {
    expect(CORPUS.plans.length).toBeGreaterThan(0);
    for (const entry of CORPUS.plans) expect(sorted(planViolations(entry.plan).map(asExpected)), entry.name).toEqual(sorted(entry.violations));
  });

  it("accepts a plan whose delegatedCopyApproval scopes repeat an item", () => {
    const entry = CORPUS.plans.find((candidate) => candidate.name === "valid-delegated-copy-approval-repeated-scope")!;
    expect(entry.violations).toEqual([]);
    expect(planViolations(entry.plan)).toEqual([]);
  });

  it("never quotes the value at fault in a message, only its position", () => {
    for (const entry of CORPUS.plans) {
      for (const violation of planViolations(entry.plan)) {
        const value = at(entry.plan, violation.path);
        expect(violation.message, entry.name).toMatch(/^plan[.[]/);
        if (typeof value === "string" && value.trim().length >= 4) expect(violation.message, entry.name).not.toContain(value);
      }
    }
  });
});

describe("inherited members are ignored, as the schema ignores them", () => {
  const corpusPlan = (name: string) => CORPUS.plans.find((entry) => entry.name === name)!.plan as Record<string, unknown>;
  const withPrototype = (prototype: object, own: Record<string, unknown>) => Object.assign(Object.create(prototype) as Record<string, unknown>, own);
  const full = corpusPlan("valid-staffed-with-packages");
  const bare = corpusPlan("valid-without-new-fields");
  const { resolution, ...withoutResolution } = full;

  it("accepts a plan whose staffing, packages, resolution and kits are only inherited", () => {
    const plan = withPrototype({ staffing: [], packages: [{}], resolution: {}, kits: [{}, {}] }, bare);
    expect(planViolations(plan)).toEqual([]);
  });

  it("does not count an inherited resolution as present (R6)", () => {
    const plan = withPrototype({ resolution }, withoutResolution);
    expect(sorted(planViolations(plan).map(asExpected))).toEqual([{ rule: "R6", path: "resolution" }]);
  });

  it("does not count an inherited packages as present (R6)", () => {
    const { packages, ...rest } = full;
    const plan = withPrototype({ packages }, rest);
    expect(sorted(planViolations(plan).map(asExpected))).toEqual([{ rule: "R6", path: "resolution" }]);
  });
});

describe("arrays with holes are refused by the shared checker, before any rule runs", () => {
  // JSON never produces a hole; a caller building a value in code can.
  const plan = () => structuredClone(CORPUS.plans.find((entry) => entry.name === "valid-staffed-with-packages")!.plan) as Record<string, any>;
  const holey = <T>(items: T[], extra = 1): T[] => {
    const copy = [...items];
    copy.length += extra;
    return copy;
  };
  const cases: [string, () => Record<string, any>, string][] = [
    ["a hole in the middle of staffing", () => { const value = plan(); value.staffing = [value.staffing[0], , value.staffing[1]]; return value; }, "staffing"],
    ["a trailing hole in packages", () => { const value = plan(); value.packages = holey(value.packages); return value; }, "packages"],
    ["a hole in one staffing entry's roles", () => { const value = plan(); value.staffing[0].roles = holey(value.staffing[0].roles); return value; }, "staffing[0].roles"],
    ["a hole in mandate.roles", () => { const value = plan(); value.mandate.roles = holey(value.mandate.roles); return value; }, "mandate.roles"],
  ];

  it("refuses each as a schema violation at the array itself, and never throws", () => {
    for (const [name, build, path] of cases) {
      expect(sorted(planViolations(build()).map(asExpected)), name).toEqual([{ rule: "schema", path }]);
    }
  });
});

describe("hub-only roles (R2, R11)", () => {
  it("are read from the packed plan contract's definitions.hubOnlyRoles", () => {
    const definitions = ADVISOR_PLAN_CONTRACT.definitions as Record<string, { const: unknown }>;
    expect(HUB_ONLY_ROLES).toEqual(definitions.hubOnlyRoles!.const);
    expect(HUB_ONLY_ROLES).toEqual(["advisor", "integrator"]);
  });
});
