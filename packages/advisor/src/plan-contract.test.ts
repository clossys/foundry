import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertImplementedContract, ContractDocumentError, readContractDocument } from "./contract-schema.js";
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
    expect(messages(badDate)).toEqual(["plan.decisions[0].at must be a real ISO 8601 date-time with a time zone, such as 2026-09-24T12:00:00Z"]);
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

/** Out-of-range times the contract's shape alone once accepted (#1475): each must be refused. */
const BAD_DATE_TIMES = [
  "2026-13-01T00:00:00Z", // month 13
  "2026-00-10T00:00:00Z", // month 0
  "2026-09-32T00:00:00Z", // day 32
  "2026-09-31T00:00:00Z", // September has 30 days
  "2026-02-30T00:00:00Z", // February 30
  "2026-02-29T00:00:00Z", // February 29 in a non-leap year
  "2100-02-29T00:00:00Z", // 2100 is not a leap year
  "2026-09-24T24:30:00Z", // hour 24
  "2026-09-24T12:60:00Z", // minute 60
  "2026-09-24T12:00:60Z", // second 60
  "2026-09-24T12:00:00+24:00", // offset hour 24
  "2026-09-24T12:00:00+05:60", // offset minute 60
  "2026-13-45T25:61:61Z",
];
const GOOD_DATE_TIMES = ["2028-02-29T00:00:00Z", "2000-02-29T12:00:00Z", "2026-09-24T23:59:59.999+23:59", "2026-09-24T12:00Z", "2026-09-24T12:00:00-05:00"];
const BAD_DATES = ["2026-02-30", "2026-02-29", "2026-13-01", "2026-09-31", "2026-9-01"];
const GOOD_DATES = ["2028-02-29", "2026-09-30"];
const DATE_TIME_MESSAGE = "must be a real ISO 8601 date-time with a time zone, such as 2026-09-24T12:00:00Z";
const DATE_OR_DATE_TIME_MESSAGE = "must be a real ISO 8601 date such as 2026-09-24, or a date-time with a time zone such as 2026-09-24T12:00:00Z";

describe("plan times are real calendar times, checked field by field (#1475)", () => {
  const withByWhen = (byWhen: string) => ({ ...PLAN, blockers: [{ ...PLAN.blockers[0]!, nextAction: { ...PLAN.blockers[0]!.nextAction, byWhen } }] });

  it("refuses every out-of-range date-time, and accepts real ones including Feb 29 of a leap year", () => {
    for (const asOf of BAD_DATE_TIMES) expect(messages(validateAdvisorPlan({ ...PLAN, asOf })), asOf).toEqual([`plan.asOf ${DATE_TIME_MESSAGE}`]);
    for (const asOf of GOOD_DATE_TIMES) expect(validateAdvisorPlan({ ...PLAN, asOf }), asOf).toEqual([]);
  });

  it("refuses an out-of-range date or date-time where either is allowed", () => {
    for (const byWhen of [...BAD_DATES, ...BAD_DATE_TIMES]) {
      expect(messages(validateAdvisorPlan(withByWhen(byWhen))), byWhen).toEqual([`plan.blockers[0].nextAction.byWhen ${DATE_OR_DATE_TIME_MESSAGE}`]);
    }
    for (const byWhen of [...GOOD_DATES, ...GOOD_DATE_TIMES]) expect(validateAdvisorPlan(withByWhen(byWhen)), byWhen).toEqual([]);
  });

  it("refuses the decision time that used to sort as NaN and let array order decide approval", () => {
    const decisions = [
      { at: "2026-09-25T00:00:00Z", recommended: "x", chosen: "rejected", by: "sponsor" },
      { at: "2026-09-24T24:30:00Z", recommended: "x", chosen: "approved", by: "sponsor" },
    ];
    expect(messages(validateAdvisorPlan({ ...PLAN, decisions }))).toEqual([`plan.decisions[1].at ${DATE_TIME_MESSAGE}`]);
  });

  it("every accepted time parses to a finite instant", () => {
    for (const text of [...GOOD_DATE_TIMES, ...GOOD_DATES]) expect(Number.isFinite(Date.parse(text)), text).toBe(true);
  });
});

describe("keys in messages are escaped, never raw (#1475)", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it("shows an unknown key with control characters as an escaped JSON string", () => {
    const [message] = messages(validateEngagementBrief({ ...BRIEF, "\u001b[2J\u009b": 1 }));
    expect(message).toBe('brief["\\u001b[2J\\u009b"] is not a field the contract declares, and unknown fields are refused');
    expect(message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });

  it("shows a repeated key and its path escaped", () => {
    let message = "";
    try {
      readContractDocument(bytes('{"\\u001b]0;x\\u0007":{"k\\u202e":1,"k\\u202e":2}}'));
    } catch (cause) {
      message = (cause as Error).message;
    }
    expect(message).toBe('repeats the key "k\\u202e" in ["\\u001b]0;x\\u0007"]; every key may appear once');
    expect(message).not.toMatch(/[\u0000-\u001f\u007f-\u009f‮]/);
  });

  it("escapes the Arabic letter mark, a bidi control, in a repeated key", () => {
    let message = "";
    try {
      readContractDocument(bytes('{"a\\u061cb":1,"a\\u061cb":2}'));
    } catch (cause) {
      message = (cause as Error).message;
    }
    expect(message).toBe('repeats the key "a\\u061cb" in the top-level object; every key may appear once');
    expect(message).not.toContain("\u061c");
  });

  it("reports why a file was refused as data, with a position only for a syntax error", () => {
    const refusal = (text: Uint8Array): ContractDocumentError => {
      try {
        readContractDocument(text);
      } catch (cause) {
        if (cause instanceof ContractDocumentError) return cause;
        throw cause;
      }
      throw new Error("expected a refusal");
    };
    expect(refusal(bytes('{"a":1,}'))).toMatchObject({ reason: "syntax", position: 7 });
    expect(refusal(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("{}")]))).toMatchObject({ reason: "syntax", position: 0 });
    expect(refusal(new Uint8Array([0x7b, 0xff, 0x7d]))).toMatchObject({ reason: "encoding", position: undefined });
    // A key that reads like a position is still a key: the message names it,
    // but `position` stays unset, so a caller relaying only `position`
    // never relays file text.
    const repeated = refusal(bytes('{"position 5551234567":1,"position 5551234567":2}'));
    expect(repeated).toMatchObject({ reason: "repeated-key", position: undefined });
  });

  it("refuses a leading byte order mark instead of stripping it", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("{}")]);
    expect(() => readContractDocument(withBom)).toThrow("is not valid JSON at position 0: it starts with a byte order mark, which strict JSON refuses");
  });
});

describe("validateEngagementBrief against the brief contract", () => {
  it("accepts every goal direction the contract lists", () => {
    for (const direction of ["increase", "decrease", "maintain", "target-range"]) {
      const role = { ...BRIEF.roles[0]!, goal: { metric: "message-clarity-score", direction } };
      expect(validateEngagementBrief({ ...BRIEF, roles: [role] }), direction).toEqual([]);
    }
  });

  it("refuses a whitespace-only problem, role, why, or metric", () => {
    const role = BRIEF.roles[0]!;
    const cases: [string, unknown][] = [
      ["brief.problem", { ...BRIEF, problem: "   " }],
      ["brief.roles[0].role", { ...BRIEF, roles: [{ ...role, role: " " }] }],
      ["brief.roles[0].why", { ...BRIEF, roles: [{ ...role, why: "\t\n" }] }],
      ["brief.roles[0].goal.metric", { ...BRIEF, roles: [{ ...role, goal: { ...role.goal, metric: " " } }] }],
    ];
    for (const [where, brief] of cases) expect(messages(validateEngagementBrief(brief)), where).toEqual([`${where} must be a string with at least one non-whitespace character`]);
  });

  it("refuses an empty string in inputsFrom, outputsTo, sequence, or deliverables", () => {
    const role = BRIEF.roles[0]!;
    expect(messages(validateEngagementBrief({ ...BRIEF, roles: [{ ...role, inputsFrom: [""] }] }))).toEqual(["brief.roles[0].inputsFrom[0] must be at least 1 character(s) long"]);
    expect(messages(validateEngagementBrief({ ...BRIEF, roles: [{ ...role, outputsTo: [""] }] }))).toEqual(["brief.roles[0].outputsTo[0] must be at least 1 character(s) long"]);
    expect(messages(validateEngagementBrief({ ...BRIEF, deliverables: [""] }))).toEqual(["brief.deliverables[0] must be at least 1 character(s) long"]);
    expect(messages(validateEngagementBrief({ ...BRIEF, sequence: [""] }))).toEqual(["brief.sequence[0] must be at least 1 character(s) long"]);
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
