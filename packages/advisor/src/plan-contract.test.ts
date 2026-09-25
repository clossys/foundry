import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertImplementedContract, readContractDocument } from "./contract-schema.js";
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

  it("says what a whole document must be in plain words, with no path", () => {
    expect(validateAdvisorPlan(5)).toEqual([{ rule: "advisor-plan-contract", severity: "error", message: "plan must be an object (the Advisor plan), got integer" }]);
    expect(messages(validateEngagementBrief([]))).toEqual(["brief must be an object (the Engagement brief), got array"]);
    expect(messages(validateAdvisorPlan({ ...PLAN, whereWeAre: "x" }))).toEqual(["plan.whereWeAre must be an array, got string"]);
  });

  it("names the field at fault inside recommendedNext rather than only saying no form matched", () => {
    expect(messages(validateAdvisorPlan({ ...PLAN, recommendedNext: { owner: "sponsor" } }))).toEqual(["plan.recommendedNext.action is required"]);
    expect(validateAdvisorPlan({ ...PLAN, recommendedNext: null })).toEqual([]);
  });
});

describe("well-formed Unicode: a plan or brief that validates always has a digest (#1475)", () => {
  const LONE = { high: "x\ud800", low: "\udc00x" };

  it("refuses a lone high or low surrogate in any plan string, so no valid plan is undigestible", () => {
    for (const [name, text] of Object.entries(LONE)) {
      const plan = { ...PLAN, mandate: { ...PLAN.mandate, problem: text } };
      expect(messages(validateAdvisorPlan(plan)), name).toEqual(["plan.mandate.problem must be well-formed Unicode, and contains a lone surrogate"]);
      expect(() => planDigest(plan as AdvisorPlan), name).toThrow(/invalid plan has no digest/);
    }
  });

  it("refuses a lone surrogate in a brief string or object key", () => {
    for (const [name, text] of Object.entries(LONE)) {
      expect(messages(validateEngagementBrief({ ...BRIEF, problem: text })), name).toEqual(["brief.problem must be well-formed Unicode, and contains a lone surrogate"]);
    }
    expect(messages(validateEngagementBrief({ ...BRIEF, [LONE.high]: 1 }))).toEqual(["brief has a key that must be well-formed Unicode, and contains a lone surrogate"]);
  });
});

describe("readContractDocument: strict JSON for plan and brief files (#1475)", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it("reads a well-formed document", () => {
    expect(readContractDocument(bytes(JSON.stringify(PLAN)))).toEqual(PLAN);
  });

  it("refuses a key repeated at the top level or nested, naming the key and where", () => {
    expect(() => readContractDocument(bytes('{"a":1,"b":2,"a":3}'))).toThrow('repeats the key "a" in the top-level object; every key may appear once');
    const nested = JSON.stringify(PLAN).replace('"problem":', '"problem":"EVIL","problem":');
    expect(() => readContractDocument(bytes(nested))).toThrow('repeats the key "problem" in mandate; every key may appear once');
    expect(() => readContractDocument(bytes('{"blockers":[{"kind":"a"},{"kind":"b","kind":"c"}]}'))).toThrow('repeats the key "kind" in blockers[1]');
  });

  it("compares keys after unescaping, and allows the same key in different objects", () => {
    expect(() => readContractDocument(bytes('{"a":1,"\\u0061":2}'))).toThrow('repeats the key "a"');
    expect(readContractDocument(bytes('{"a":{"a":1},"b":[{"a":1},{"a":2}],"s":"\\"{\\"a\\":1,\\"a\\":2}"}'))).toEqual({ a: { a: 1 }, b: [{ a: 1 }, { a: 2 }], s: '"{"a":1,"a":2}' });
  });

  it("refuses bytes that are not valid UTF-8 instead of replacing them with U+FFFD", () => {
    const raw = bytes('{"problem":"xy"}');
    raw[12] = 0xff;
    expect(() => readContractDocument(raw)).toThrow("is not valid UTF-8");
  });

  it("refuses JSON that does not parse by position only, never quoting the text", () => {
    const secret = "our biggest client is leaving";
    const cases: [string, number][] = [
      [`{"problem":"${secret}",}`, 43],
      [`{"problem":"${secret}" x}`, 43],
      [`{"problem":${secret}}`, 11],
      [`{"problem":"${secret}"`, 42],
      [`{"problem":"${secret}"} trailing`, 44],
      [`{"problem":"${secret}\\u12"}`, 41],
      [`["${secret}\n"]`, 31],
    ];
    for (const [text, position] of cases) {
      let message = "";
      try {
        readContractDocument(bytes(text));
      } catch (cause) {
        message = (cause as Error).message;
      }
      expect(message, text).toBe(`is not valid JSON at position ${position}`);
      expect(message, text).not.toContain("client");
    }
  });

  it("accepts every JSON value form the grammar allows", () => {
    const text = ' { "n" : [ -0 , 1.5e+3 , 2E-2 , 0.25 ] , "t" : true , "f" : false , "z" : null , "s" : "\\u00e9\\n\\/" } ';
    expect(readContractDocument(bytes(text))).toEqual({ n: [-0, 1500, 0.02, 0.25], t: true, f: false, z: null, s: "\u00e9\n/" });
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
