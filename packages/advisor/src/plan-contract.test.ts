import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertImplementedContract } from "./contract-schema.js";
import { PLAN_CONTRACTS } from "./generated/plan-contracts.generated.js";
import { ADVISOR_BLOCKER_KINDS, PLAN_DIGEST_EXCLUDED_FIELDS, canonicalJson, planDigest, validateAdvisorPlan, validateEngagementBrief } from "./index.js";
import type { AdvisorPlan, EngagementBrief } from "./index.js";

/*
 * Issue #1475: the plan record and the engagement brief are validated
 * against the shared contracts in docs/contracts/, packed into this package
 * at build time, and the canonical plan digest is checked against the
 * shared corpus @clossys/launcher is tested against too.
 */
const CONTRACTS = new URL("../../../docs/contracts/", import.meta.url);
const readJson = (name: string): unknown => JSON.parse(readFileSync(new URL(name, CONTRACTS), "utf8"));

interface DigestCorpus {
  canonicalJson: { name: string; value: unknown; canonical: string }[];
  refused: { name: string; json: string }[];
  plans: { name: string; plan: AdvisorPlan; canonical: string; digest: string }[];
}
const CORPUS = readJson("advisor-plan-digest.fixture.json") as DigestCorpus;
const corpusPlan = (name: string) => CORPUS.plans.find((entry) => entry.name === name)!;

/** Advisor's own current shape: blockers carry capabilityId, nextAction and since, and recommendedNext has no due. */
const PLAN: AdvisorPlan = corpusPlan("blockers-without-due").plan;

const BRIEF: EngagementBrief = {
  schemaVersion: 1,
  problem: "Our site doesn't explain what we do.",
  roles: [{ role: "strategist", why: "Directly confirmed.", goal: { metric: "message-clarity-score", direction: "maintain" }, inputsFrom: [], outputsTo: ["writer"] }],
  sequence: ["strategist"],
  deliverables: ["A positioning brief every later role reads first."],
};

const messages = (findings: readonly { message: string }[]) => findings.map((finding) => finding.message);

describe("packed plan and brief contracts", () => {
  it("are the docs/contracts files, unchanged", () => {
    expect(Object.keys(PLAN_CONTRACTS)).toEqual(["advisor-plan.json", "engagement-brief.json", "engagement-context.json"]);
    for (const [name, contract] of Object.entries(PLAN_CONTRACTS)) expect(contract).toEqual(readJson(name));
  });

  it("use only keywords the checker implements, in every subschema", () => {
    for (const contract of Object.values(PLAN_CONTRACTS)) expect(() => assertImplementedContract(contract)).not.toThrow();
  });

  it("list exactly ADVISOR_BLOCKER_KINDS as the blocker kinds, in order", () => {
    const definitions = PLAN_CONTRACTS["advisor-plan.json"]!.definitions as Record<string, { enum: unknown }>;
    expect(definitions.blockerKind!.enum).toEqual([...ADVISOR_BLOCKER_KINDS]);
  });
});

describe("validateAdvisorPlan against the plan contract", () => {
  it("accepts a plan with blockers and no recommendedNext.due", () => {
    expect(PLAN.blockers.length).toBeGreaterThan(0);
    expect(PLAN.recommendedNext).not.toHaveProperty("due");
    expect(validateAdvisorPlan(PLAN)).toEqual([]);
  });

  it("accepts every plan in the digest corpus", () => {
    for (const entry of CORPUS.plans) expect(validateAdvisorPlan(entry.plan), entry.name).toEqual([]);
  });

  it("refuses an unknown field at any depth, naming it", () => {
    expect(messages(validateAdvisorPlan({ ...PLAN, staffing: [] }))).toEqual(["plan.staffing is not a field the contract declares, and unknown fields are refused"]);
    const blocker = { ...PLAN.blockers[0], nextAction: { ...PLAN.blockers[0]!.nextAction, note: "x" } };
    expect(messages(validateAdvisorPlan({ ...PLAN, blockers: [blocker] }))).toEqual([
      "plan.blockers[0].nextAction.note is not a field the contract declares, and unknown fields are refused",
    ]);
  });

  it("refuses blank strings and malformed dates with a message that says what is expected", () => {
    const blank = validateAdvisorPlan({ ...PLAN, mandate: { ...PLAN.mandate, problem: "   " } });
    expect(messages(blank)).toEqual(["plan.mandate.problem must be a string with at least one non-whitespace character"]);
    const badDate = validateAdvisorPlan({ ...PLAN, decisions: [{ ...PLAN.decisions[0], at: "yesterday" }] });
    expect(messages(badDate)).toEqual(["plan.decisions[0].at must be an ISO 8601 date-time with a time zone, such as 2026-09-24T12:00:00Z"]);
  });

  it("names the field at fault inside recommendedNext rather than only saying no form matched", () => {
    expect(messages(validateAdvisorPlan({ ...PLAN, recommendedNext: { owner: "sponsor" } }))).toEqual(["plan.recommendedNext.action is required"]);
    expect(validateAdvisorPlan({ ...PLAN, recommendedNext: null })).toEqual([]);
  });
});

describe("validateEngagementBrief against the brief contract", () => {
  it("accepts every goal direction the contract lists", () => {
    for (const direction of ["increase", "decrease", "maintain", "target-range"]) {
      const role = { ...BRIEF.roles[0]!, goal: { metric: "message-clarity-score", direction } };
      expect(validateEngagementBrief({ ...BRIEF, roles: [role] }), direction).toEqual([]);
    }
  });

  it("refuses an unknown top-level field", () => {
    expect(messages(validateEngagementBrief({ ...BRIEF, notes: "x" }))).toEqual(["brief.notes is not a field the contract declares, and unknown fields are refused"]);
  });

  it("refuses a context value that is not one of the field's fixed choice ids, without echoing it", () => {
    const fields = ["business", "product", "audience", "stage", "intent", "constraints"].map((id) => ({ id, state: "unknown" }));
    const prose = "mostly dentists near our office";
    fields[2] = { id: "audience", state: "known", value: prose } as (typeof fields)[number];
    const findings = validateEngagementBrief({ ...BRIEF, context: { schemaVersion: 1, fields } });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.rule === "engagement-brief-contract")).toBe(true);
    expect(messages(findings).join("\n")).not.toContain(prose);
    expect(messages(findings)).toContain('brief.context.fields[2].value must be one of: "consumers", "businesses"');
  });
});

describe("canonical plan digest (docs/contracts/advisor-plan-digest.md)", () => {
  it("excludes exactly asOf and decisions", () => {
    expect(PLAN_DIGEST_EXCLUDED_FIELDS).toEqual(["asOf", "decisions"]);
  });

  it("serializes every corpus value to its expected canonical JSON", () => {
    for (const entry of CORPUS.canonicalJson) expect(canonicalJson(entry.value), entry.name).toBe(entry.canonical);
  });

  it("refuses every corpus value that is not well-formed Unicode", () => {
    for (const entry of CORPUS.refused) expect(() => canonicalJson(JSON.parse(entry.json)), entry.name).toThrow(/lone surrogate/);
  });

  it("refuses what JSON cannot carry instead of dropping it", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson({ a: undefined })).toThrow(/undefined/);
  });

  it("computes every corpus plan's expected digest", () => {
    for (const entry of CORPUS.plans) expect(planDigest(entry.plan), entry.name).toBe(entry.digest);
  });

  it("gives the same digest across key order, asOf and decisions, and a different one when content changes", () => {
    const digest = (name: string) => planDigest(corpusPlan(name).plan);
    expect(digest("every-key-order-reversed")).toBe(digest("blockers-without-due"));
    expect(digest("later-asof-and-new-decisions")).toBe(digest("blockers-without-due"));
    expect(digest("roles-reordered")).not.toBe(digest("blockers-without-due"));
    expect(digest("unicode-decomposed")).not.toBe(digest("unicode-precomposed"));
  });

  it("has no digest for an invalid plan", () => {
    expect(() => planDigest({ ...PLAN, extra: true } as unknown as AdvisorPlan)).toThrow(/invalid plan has no digest/);
  });
});
