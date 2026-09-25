import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyEngagementBrief, approvedSubject, isPlanApproved, validateAdvisorPlan, validateEngagementBrief, type AdvisorPlan, type EngagementBrief, type EngagementContext } from "./apply-plan.js";
import type { WorkspaceHost } from "./types.js";

/** The shared digest corpus (docs/contracts/advisor-plan-digest.fixture.json); @clossys/advisor is tested against the same file. */
const CORPUS = JSON.parse(readFileSync(new URL("../../../docs/contracts/advisor-plan-digest.fixture.json", import.meta.url), "utf8")) as {
  plans: { name: string; plan: AdvisorPlan; digest: string }[];
};
const corpusPlan = (name: string) => CORPUS.plans.find((entry) => entry.name === name)!;

/** Advisor's own current plan shape: blockers carry capabilityId, nextAction and since; recommendedNext has no due. */
const ADVISOR_SHAPED_PLAN: AdvisorPlan = corpusPlan("blockers-without-due").plan;

const CONTEXT: EngagementContext = {
  schemaVersion: 1,
  fields: [
    { id: "business", state: "unknown" },
    { id: "product", state: "known", value: "software" },
    { id: "audience", state: "known", value: "businesses" },
    { id: "stage", state: "unknown" },
    { id: "intent", state: "known", value: "grow" },
    { id: "constraints", state: "unknown" },
  ],
};

function fakeHost(): WorkspaceHost & { written: Record<string, string> } {
  const written: Record<string, string> = {};
  return {
    written,
    cwd: "/repo",
    env: {},
    isTTY: false,
    now: () => "2026-09-22T00:00:00.000Z",
    exists: () => false,
    isDirectory: () => false,
    isSymlink: () => false,
    readText: () => null,
    writeText: (path, contents) => {
      written[path] = contents;
    },
    mkdirp: () => {},
    symlink: () => {},
    remove: () => {},
    readDir: () => [],
    run: () => ({ status: 0, stdout: "", stderr: "" }),
    prompt: () => null,
  };
}

const VALID_BRIEF: EngagementBrief = {
  schemaVersion: 1,
  problem: "Our site doesn't explain what we do.",
  roles: [
    {
      role: "strategist",
      why: "Directly confirmed: it clarifies positioning and claims.",
      goal: { metric: "message-clarity-score", direction: "increase" },
      inputsFrom: [],
      outputsTo: ["writer", "designer"],
    },
  ],
  sequence: ["strategist", "writer", "designer"],
  deliverables: ["A positioning brief every later role reads first."],
};

const SUBJECT = `sha256:${"ab".repeat(32)}`;
const OTHER_SUBJECT = `sha256:${"cd".repeat(32)}`;

const VALID_PLAN: AdvisorPlan = {
  schemaVersion: 1,
  asOf: "2026-09-22T00:00:00Z",
  mandate: { problem: "Our site doesn't explain what we do.", primaryProblemId: "unclear-positioning", roles: ["strategist", "writer", "designer"] },
  whereWeAre: ["Fit and readiness both satisfied."],
  recommendedNext: null,
  decisions: [{ at: "2026-09-20T00:00:00Z", recommended: "compose from confirmed problems", chosen: "approved", by: "sponsor" }],
  blockers: [],
};

describe("validateEngagementBrief", () => {
  it("accepts the exact shape from the #1175 contract example", () => {
    expect(validateEngagementBrief(VALID_BRIEF)).toEqual({ valid: true });
  });

  it("rejects a missing roles array with a specific reason, not a generic failure", () => {
    const { roles: _roles, ...withoutRoles } = VALID_BRIEF;
    const result = validateEngagementBrief(withoutRoles);
    expect(result.valid).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/roles/);
  });

  it("rejects a goal.direction outside the contract's four, naming the allowed values", () => {
    const broken = { ...VALID_BRIEF, roles: [{ ...VALID_BRIEF.roles[0], goal: { metric: "x", direction: "sideways" } }] };
    expect(validateEngagementBrief(broken)).toEqual({
      valid: false,
      reason: 'brief.roles[0].goal.direction must be one of: "increase", "decrease", "maintain", "target-range"',
    });
  });

  it("accepts maintain and target-range, which Advisor's brief contract allows (#1475)", () => {
    for (const direction of ["maintain", "target-range"] as const) {
      const brief = { ...VALID_BRIEF, roles: [{ ...VALID_BRIEF.roles[0]!, goal: { metric: "x", direction } }] };
      expect(validateEngagementBrief(brief), direction).toEqual({ valid: true });
    }
  });

  it("refuses a field the brief contract does not declare, by its position, never its name", () => {
    expect(validateEngagementBrief({ ...VALID_BRIEF, notes: "x" })).toEqual({
      valid: false,
      reason: `brief has a field the contract does not declare (key ${Object.keys(VALID_BRIEF).length + 1} of this object), and unknown fields are refused`,
    });
  });

  it("accepts a context snapshot of fixed choice ids", () => {
    expect(validateEngagementBrief({ ...VALID_BRIEF, context: CONTEXT })).toEqual({ valid: true });
  });

  it("refuses a context value that is founder text rather than a fixed choice id, without echoing it", () => {
    const prose = "mostly dentists near our office";
    const context = { schemaVersion: 1, fields: CONTEXT.fields.map((field) => (field.id === "audience" ? { id: "audience", state: "known", value: prose } : field)) };
    const result = validateEngagementBrief({ ...VALID_BRIEF, context });
    expect(result.valid).toBe(false);
    const reason = (result as { reason: string }).reason;
    expect(reason).toContain('brief.context.fields[2].value must be one of: "consumers", "businesses"');
    expect(reason).not.toContain(prose);
  });

  it("refuses a context snapshot missing a field id", () => {
    const context = { schemaVersion: 1, fields: CONTEXT.fields.filter((field) => field.id !== "intent") };
    expect(validateEngagementBrief({ ...VALID_BRIEF, context }).valid).toBe(false);
  });

  it("rejects the wrong schemaVersion", () => {
    expect(validateEngagementBrief({ ...VALID_BRIEF, schemaVersion: 2 }).valid).toBe(false);
  });

  it("rejects a non-object entirely, never throws", () => {
    expect(validateEngagementBrief("not an object").valid).toBe(false);
    expect(validateEngagementBrief(null).valid).toBe(false);
  });
});

describe("validateAdvisorPlan", () => {
  it("accepts the exact shape from the #1175 contract example", () => {
    expect(validateAdvisorPlan(VALID_PLAN)).toEqual({ valid: true });
  });

  it("accepts a populated recommendedNext", () => {
    const plan = { ...VALID_PLAN, recommendedNext: { action: "Approve the first-wave plan.", owner: "sponsor", due: "2026-09-29T00:00:00Z" } };
    expect(validateAdvisorPlan(plan)).toEqual({ valid: true });
  });

  it("accepts Advisor's own blocker shape with no recommendedNext.due (#1475)", () => {
    expect(ADVISOR_SHAPED_PLAN.blockers.length).toBeGreaterThan(0);
    expect(ADVISOR_SHAPED_PLAN.recommendedNext).not.toHaveProperty("due");
    expect(validateAdvisorPlan(ADVISOR_SHAPED_PLAN)).toEqual({ valid: true });
  });

  it("refuses the old local blocker shape (description, dueDate) and says why", () => {
    const plan = { ...VALID_PLAN, blockers: [{ kind: "missing-input", description: "x", owner: "y", dueDate: "2026-09-25" }] };
    const result = validateAdvisorPlan(plan);
    expect(result.valid).toBe(false);
    const reason = (result as { reason: string }).reason;
    for (const expected of [
      "plan.blockers[0].capabilityId is required",
      "plan.blockers[0].nextAction is required",
      "plan.blockers[0].since is required",
      "plan.blockers[0] has a field the contract does not declare (key 2 of this object), and unknown fields are refused",
      "plan.blockers[0] has a field the contract does not declare (key 4 of this object), and unknown fields are refused",
    ]) expect(reason).toContain(expected);
    expect(reason).not.toMatch(/description|dueDate/);
  });

  it("rejects a blocker with an unrecognized kind", () => {
    const plan = { ...ADVISOR_SHAPED_PLAN, blockers: [{ ...ADVISOR_SHAPED_PLAN.blockers[0], kind: "something-else" }] };
    expect(validateAdvisorPlan(plan)).toEqual({
      valid: false,
      reason: 'plan.blockers[0].kind must be one of: "missing-input", "missing-authority", "failing-evidence", "unavailable-environment", "contradiction"',
    });
  });

  it("refuses an unknown field nested in the plan, at the object that holds it", () => {
    const plan = { ...VALID_PLAN, mandate: { ...VALID_PLAN.mandate, owner: "x" } };
    expect(validateAdvisorPlan(plan)).toEqual({ valid: false, reason: `plan.mandate has a field the contract does not declare (key ${Object.keys(VALID_PLAN.mandate).length + 1} of this object), and unknown fields are refused` });
  });

  it("refuses a decision whose time is not an ISO 8601 date-time", () => {
    const plan = { ...VALID_PLAN, decisions: [{ ...VALID_PLAN.decisions[0]!, at: "last week" }] };
    expect(validateAdvisorPlan(plan)).toEqual({ valid: false, reason: "plan.decisions[0].at must be a real ISO 8601 date-time with a time zone, such as 2026-09-24T12:00:00Z" });
  });

  it("rejects a decision missing any of its four required fields", () => {
    const plan = { ...VALID_PLAN, decisions: [{ at: "2026-09-20T00:00:00Z", recommended: "x", chosen: "approved" }] };
    expect(validateAdvisorPlan(plan)).toEqual({ valid: false, reason: "plan.decisions[0].by is required" });
  });
});

describe("well-formed Unicode (#1475): a plan or brief that validates always has a digest", () => {
  const LONE = { high: "x\ud800", low: "\udc00x" };

  it("refuses a lone high or low surrogate in the plan and in the brief", () => {
    for (const [name, text] of Object.entries(LONE)) {
      const plan = { ...ADVISOR_SHAPED_PLAN, mandate: { ...ADVISOR_SHAPED_PLAN.mandate, problem: text } };
      expect(validateAdvisorPlan(plan), name).toEqual({ valid: false, reason: "plan.mandate.problem must be well-formed Unicode, and contains a lone surrogate" });
      expect(validateEngagementBrief({ ...VALID_BRIEF, problem: text }), name).toEqual({
        valid: false,
        reason: "brief.problem must be well-formed Unicode, and contains a lone surrogate",
      });
    }
  });
});

describe("plan times through Launcher's generated checker copy (#1475)", () => {
  const BAD_DATE_TIMES = [
    "2026-13-01T00:00:00Z", "2026-09-32T00:00:00Z", "2026-02-30T00:00:00Z", "2026-02-29T00:00:00Z", "2026-09-24T24:30:00Z",
    "2026-09-24T12:00:60Z", "2026-09-24T12:00:00+24:00", "2026-09-24T12:00:00+05:60", "2026-13-45T25:61:61Z",
  ];
  const withByWhen = (byWhen: string) => ({
    ...ADVISOR_SHAPED_PLAN,
    blockers: [{ ...ADVISOR_SHAPED_PLAN.blockers[0]!, nextAction: { ...ADVISOR_SHAPED_PLAN.blockers[0]!.nextAction, byWhen } }],
  });

  it("refuses every out-of-range time and accepts Feb 29 of a leap year", () => {
    for (const asOf of BAD_DATE_TIMES) {
      expect(validateAdvisorPlan({ ...ADVISOR_SHAPED_PLAN, asOf }), asOf).toEqual({
        valid: false,
        reason: "plan.asOf must be a real ISO 8601 date-time with a time zone, such as 2026-09-24T12:00:00Z",
      });
    }
    for (const byWhen of ["2026-02-30", "2026-02-29", "2026-13-01", ...BAD_DATE_TIMES]) expect(validateAdvisorPlan(withByWhen(byWhen)).valid, byWhen).toBe(false);
    expect(validateAdvisorPlan({ ...ADVISOR_SHAPED_PLAN, asOf: "2028-02-29T00:00:00Z" })).toEqual({ valid: true });
    expect(validateAdvisorPlan(withByWhen("2028-02-29"))).toEqual({ valid: true });
  });

  it("refuses the NaN-ordering repro at validation, in isPlanApproved and approvedSubject, and in applyEngagementBrief", () => {
    const plan = {
      ...ADVISOR_SHAPED_PLAN,
      decisions: [
        { at: "2026-09-25T00:00:00Z", recommended: "x", chosen: "rejected", by: "sponsor" },
        { at: "2026-09-24T24:30:00Z", recommended: "x", chosen: "approved", by: "sponsor" },
      ],
    };
    expect(validateAdvisorPlan(plan)).toEqual({ valid: false, reason: "plan.decisions[1].at must be a real ISO 8601 date-time with a time zone, such as 2026-09-24T12:00:00Z" });
    expect(isPlanApproved(plan)).toBe(false);
    expect(approvedSubject({ ...plan, decisions: plan.decisions.map((decision) => ({ ...decision, subjectDigest: SUBJECT })) })).toBeNull();
    const host = fakeHost();
    expect(applyEngagementBrief(host, "/repo", plan, VALID_BRIEF, "clossys/brief.json").state).toBe("refused");
    expect(Object.keys(host.written)).toHaveLength(0);
  });
});

describe("whitespace-only brief strings and escaped keys (#1475)", () => {
  it("refuses a whitespace-only problem, role, why, or metric, as 0.3.1 did", () => {
    const role = VALID_BRIEF.roles[0]!;
    expect(validateEngagementBrief({ ...VALID_BRIEF, problem: "  " })).toEqual({ valid: false, reason: "brief.problem must be a string with at least one non-whitespace character" });
    expect(validateEngagementBrief({ ...VALID_BRIEF, roles: [{ ...role, role: " " }] }).valid).toBe(false);
    expect(validateEngagementBrief({ ...VALID_BRIEF, roles: [{ ...role, why: "\t" }] }).valid).toBe(false);
    expect(validateEngagementBrief({ ...VALID_BRIEF, roles: [{ ...role, goal: { ...role.goal, metric: " " } }] }).valid).toBe(false);
  });

  it("refuses an empty string in inputsFrom, outputsTo, sequence, or deliverables", () => {
    const role = VALID_BRIEF.roles[0]!;
    expect(validateEngagementBrief({ ...VALID_BRIEF, roles: [{ ...role, inputsFrom: [""] }] }).valid).toBe(false);
    expect(validateEngagementBrief({ ...VALID_BRIEF, roles: [{ ...role, outputsTo: [""] }] }).valid).toBe(false);
    expect(validateEngagementBrief({ ...VALID_BRIEF, sequence: [""] }).valid).toBe(false);
    expect(validateEngagementBrief({ ...VALID_BRIEF, deliverables: [""] })).toEqual({ valid: false, reason: "brief.deliverables[0] must be at least 1 character(s) long" });
  });

  it("never shows an unknown key with control characters, escaped or raw", () => {
    const result = validateEngagementBrief({ ...VALID_BRIEF, "\u001b[2J": 1 });
    expect(result).toEqual({ valid: false, reason: `brief has a field the contract does not declare (key ${Object.keys(VALID_BRIEF).length + 1} of this object), and unknown fields are refused` });
  });
});

describe("isPlanApproved", () => {
  it("is approved when the most recent decision's chosen is 'approved'", () => {
    expect(isPlanApproved(VALID_PLAN)).toBe(true);
  });

  it("is not approved when there are no decisions -- never assumed from absence", () => {
    expect(isPlanApproved({ ...VALID_PLAN, decisions: [] })).toBe(false);
  });

  it("is not approved when the most recent decision is something other than 'approved'", () => {
    const plan = { ...VALID_PLAN, decisions: [{ at: "2026-09-20T00:00:00Z", recommended: "x", chosen: "deferred", by: "sponsor" }] };
    expect(isPlanApproved(plan)).toBe(false);
  });

  it("is not approved when any decision's time does not parse, whatever the array order", () => {
    const plan = {
      ...VALID_PLAN,
      decisions: [
        { at: "2026-09-25T00:00:00Z", recommended: "x", chosen: "rejected", by: "sponsor" },
        { at: "not a time", recommended: "x", chosen: "approved", by: "sponsor" },
      ],
    };
    expect(isPlanApproved(plan)).toBe(false);
  });

  it("is not approved when two decisions share the latest instant and they disagree", () => {
    const tied = (first: string, second: string) => ({
      ...VALID_PLAN,
      decisions: [
        { at: "2026-09-25T02:00:00+02:00", recommended: "x", chosen: first, by: "sponsor" },
        { at: "2026-09-25T00:00:00Z", recommended: "x", chosen: second, by: "sponsor" },
      ],
    });
    expect(isPlanApproved(tied("rejected", "approved"))).toBe(false);
    expect(isPlanApproved(tied("approved", "rejected"))).toBe(false);
    expect(isPlanApproved(tied("approved", "approved"))).toBe(true);
  });

  it("uses the MOST RECENT decision by timestamp, not the array's last entry, when they differ", () => {
    const plan = {
      ...VALID_PLAN,
      decisions: [
        { at: "2026-09-22T00:00:00Z", recommended: "x", chosen: "approved", by: "sponsor" },
        { at: "2026-09-20T00:00:00Z", recommended: "y", chosen: "deferred", by: "sponsor" },
      ],
    };
    expect(isPlanApproved(plan)).toBe(true);
  });

  it("binds no bytes: it is true for an approval with no subjectDigest, where approvedSubject is null (#1178)", () => {
    expect(isPlanApproved(VALID_PLAN)).toBe(true);
    expect(approvedSubject(VALID_PLAN)).toBeNull();
  });
});

describe("approvedSubject (#1178): what an approval binds, failing closed", () => {
  const approve = (at: string, subjectDigest?: string, chosen = "approved") => ({ at, recommended: "x", chosen, by: "sponsor", ...(subjectDigest === undefined ? {} : { subjectDigest }) });
  const withDecisions = (...decisions: ReturnType<typeof approve>[]): AdvisorPlan => ({ ...VALID_PLAN, decisions });

  it("returns the subjectDigest of an approving latest decision", () => {
    expect(approvedSubject(withDecisions(approve("2026-09-20T00:00:00Z", SUBJECT)))).toBe(SUBJECT);
  });

  it("binds nothing when the approval carries no subjectDigest", () => {
    expect(approvedSubject(VALID_PLAN)).toBeNull();
    expect(approvedSubject(withDecisions(approve("2026-09-20T00:00:00Z")))).toBeNull();
  });

  it("binds nothing when there are no decisions -- never assumed from absence", () => {
    expect(approvedSubject(withDecisions())).toBeNull();
  });

  it("binds nothing when the latest decision is not 'approved', even if an earlier approval named a subject", () => {
    expect(approvedSubject(withDecisions(approve("2026-09-20T00:00:00Z", SUBJECT), approve("2026-09-21T00:00:00Z", SUBJECT, "deferred")))).toBeNull();
    expect(approvedSubject(withDecisions(approve("2026-09-21T00:00:00Z", SUBJECT, "Approved")))).toBeNull();
  });

  it("uses the latest decision by time, not the array's last entry", () => {
    expect(approvedSubject(withDecisions(approve("2026-09-22T00:00:00Z", SUBJECT), approve("2026-09-20T00:00:00Z", OTHER_SUBJECT)))).toBe(SUBJECT);
    expect(approvedSubject(withDecisions(approve("2026-09-22T00:00:00Z", SUBJECT), approve("2026-09-20T00:00:00Z", undefined, "rejected")))).toBe(SUBJECT);
  });

  it("binds nothing when any decision time does not parse, whatever the array order", () => {
    expect(approvedSubject(withDecisions(approve("2026-09-25T00:00:00Z", SUBJECT), approve("not a time", SUBJECT)))).toBeNull();
    expect(approvedSubject(withDecisions(approve("2026-09-24T24:30:00Z", SUBJECT)))).toBeNull();
  });

  it("on a tie at the latest instant, binds only when every tied decision approves the same subject", () => {
    const tied = (first: ReturnType<typeof approve>, second: ReturnType<typeof approve>) => withDecisions(first, second);
    const early = "2026-09-25T02:00:00+02:00";
    const late = "2026-09-25T00:00:00Z";
    expect(approvedSubject(tied(approve(early, SUBJECT), approve(late, SUBJECT)))).toBe(SUBJECT);
    expect(approvedSubject(tied(approve(early, SUBJECT), approve(late, OTHER_SUBJECT)))).toBeNull();
    expect(approvedSubject(tied(approve(early, SUBJECT), approve(late)))).toBeNull();
    expect(approvedSubject(tied(approve(early), approve(late, SUBJECT)))).toBeNull();
    expect(approvedSubject(tied(approve(early, SUBJECT), approve(late, SUBJECT, "rejected")))).toBeNull();
    expect(approvedSubject(tied(approve(early, SUBJECT, "rejected"), approve(late, SUBJECT)))).toBeNull();
  });

  it("binds nothing for a subjectDigest that is not a sha256 digest, even on a plan no one validated", () => {
    for (const bad of ["", "sha256:", SUBJECT.toUpperCase(), SUBJECT.slice(0, -1), `${SUBJECT}0`, SUBJECT.replace("sha256:", "sha512:"), ` ${SUBJECT}`]) {
      expect(approvedSubject(withDecisions(approve("2026-09-20T00:00:00Z", bad))), JSON.stringify(bad)).toBeNull();
    }
    expect(approvedSubject(withDecisions({ ...approve("2026-09-20T00:00:00Z"), subjectDigest: 5 } as unknown as ReturnType<typeof approve>))).toBeNull();
  });

  it("binds nothing on a plan that does not validate, so the machine's time zone cannot pick the latest decision", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      // A time with no offset parses as local time: here 07:00Z, later than the 03:00Z rejection.
      expect(Date.parse("2026-09-25T00:00:00")).toBe(Date.parse("2026-09-25T07:00:00Z"));
      const plan = withDecisions(approve("2026-09-25T00:00:00", SUBJECT), approve("2026-09-25T03:00:00Z", SUBJECT, "rejected"));
      expect(validateAdvisorPlan(plan).valid).toBe(false);
      expect(approvedSubject(plan)).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("handles 300,000 decisions without throwing, in both approvedSubject and isPlanApproved", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const decisions = Array.from({ length: 300_000 }, (_, index) => approve(new Date(start + index * 1000).toISOString(), SUBJECT));
    // Built without spreading the list into a call's arguments, which would itself throw a RangeError.
    const approved: AdvisorPlan = { ...VALID_PLAN, decisions };
    expect(approvedSubject(approved)).toBe(SUBJECT);
    expect(isPlanApproved(approved)).toBe(true);
    const rejected: AdvisorPlan = { ...VALID_PLAN, decisions: [...decisions.slice(0, -1), approve(decisions.at(-1)!.at, SUBJECT, "rejected")] };
    expect(approvedSubject(rejected)).toBeNull();
    expect(isPlanApproved(rejected)).toBe(false);
  }, 60_000);

  it("is what the plan contract accepts: an approving plan with a subjectDigest validates", () => {
    expect(validateAdvisorPlan(withDecisions(approve("2026-09-20T00:00:00Z", SUBJECT)))).toEqual({ valid: true });
  });
});

describe("applyEngagementBrief", () => {
  it("refuses, and writes nothing, when the plan is not approved", () => {
    const host = fakeHost();
    const result = applyEngagementBrief(host, "/repo", { ...VALID_PLAN, decisions: [] }, VALID_BRIEF, "clossys/brief.json");
    expect(result.state).toBe("refused");
    expect(Object.keys(host.written)).toHaveLength(0);
  });

  it("refuses, and writes nothing, when the brief does not validate, even if the plan is approved", () => {
    const host = fakeHost();
    const { roles: _roles, ...brokenBrief } = VALID_BRIEF;
    const result = applyEngagementBrief(host, "/repo", VALID_PLAN, brokenBrief as unknown as EngagementBrief, "clossys/brief.json");
    expect(result.state).toBe("refused");
    expect(Object.keys(host.written)).toHaveLength(0);
  });

  it("refuses, and writes nothing, when the brief's context snapshot breaks the contract", () => {
    const host = fakeHost();
    const context = { schemaVersion: 1, fields: [...CONTEXT.fields, { id: "audience", state: "unknown" }] };
    const result = applyEngagementBrief(host, "/repo", VALID_PLAN, { ...VALID_BRIEF, context } as unknown as EngagementBrief, "clossys/brief.json");
    expect(result).toEqual({ state: "refused", reason: "brief does not validate: brief.context.fields must have at most 6 item(s)" });
    expect(Object.keys(host.written)).toHaveLength(0);
  });

  it("refuses, and writes nothing, when the plan does not validate, even if its latest decision is approved", () => {
    const host = fakeHost();
    const result = applyEngagementBrief(host, "/repo", { ...VALID_PLAN, notes: [] } as unknown as AdvisorPlan, VALID_BRIEF, "clossys/brief.json");
    expect(result).toEqual({ state: "refused", reason: `plan does not validate: plan has a field the contract does not declare (key ${Object.keys(VALID_PLAN).length + 1} of this object), and unknown fields are refused` });
    expect(Object.keys(host.written)).toHaveLength(0);
  });

  it("refuses, and writes nothing, when the plan breaks a code rule", () => {
    const host = fakeHost();
    const plan = { ...VALID_PLAN, staffing: [{ repository: "example-owner/site", roles: ["strategist", "writer", "designer"] }, { repository: "Example-Owner/Site", roles: ["writer"] }] };
    const result = applyEngagementBrief(host, "/repo", plan, VALID_BRIEF, "clossys/brief.json");
    expect(result).toEqual({ state: "refused", reason: "plan does not validate: plan.staffing[1].repository names the same repository as staffing[0].repository (repository ids compare case-insensitively) (rule R1)" });
    expect(Object.keys(host.written)).toHaveLength(0);
  });

  it("stays the legacy path: it still applies an approval that carries no subjectDigest, as it always has", () => {
    expect(approvedSubject(VALID_PLAN)).toBeNull();
    const host = fakeHost();
    expect(applyEngagementBrief(host, "/repo", VALID_PLAN, VALID_BRIEF, "clossys/brief.json").state).toBe("applied");
  });

  it("keeps the legacy approval rule on a tie, with or without subjectDigest", () => {
    const tied = (first: string, second: string): AdvisorPlan => ({
      ...VALID_PLAN,
      decisions: [
        { at: "2026-09-25T02:00:00+02:00", recommended: "x", chosen: first, by: "sponsor" },
        { at: "2026-09-25T00:00:00Z", recommended: "x", chosen: second, by: "sponsor", subjectDigest: SUBJECT },
      ],
    });
    const state = (plan: AdvisorPlan) => applyEngagementBrief(fakeHost(), "/repo", plan, VALID_BRIEF, "clossys/brief.json").state;
    expect(state(tied("approved", "approved"))).toBe("applied");
    expect(state(tied("rejected", "approved"))).toBe("refused");
    expect(state(tied("approved", "rejected"))).toBe("refused");
  });

  it("applies an Advisor-shaped plan with blockers and a brief with context, and reports the plan's canonical digest", () => {
    const host = fakeHost();
    const brief = { ...VALID_BRIEF, context: CONTEXT };
    const result = applyEngagementBrief(host, "/repo", ADVISOR_SHAPED_PLAN, brief, "clossys/brief.json");
    expect(result).toEqual({ state: "applied", path: "/repo/clossys/brief.json", planDigest: corpusPlan("blockers-without-due").digest });
    expect(JSON.parse(host.written["/repo/clossys/brief.json"] as string)).toEqual(brief);
  });

  it("writes nothing, and never throws, on any refusal -- including a lone surrogate in the plan or the brief", () => {
    const refusals: [string, AdvisorPlan, EngagementBrief][] = [
      ["plan lone high surrogate", { ...ADVISOR_SHAPED_PLAN, mandate: { ...ADVISOR_SHAPED_PLAN.mandate, problem: "x\ud800" } }, VALID_BRIEF],
      ["plan lone low surrogate", { ...ADVISOR_SHAPED_PLAN, whereWeAre: ["\udc00"] }, VALID_BRIEF],
      ["brief lone surrogate", ADVISOR_SHAPED_PLAN, { ...VALID_BRIEF, problem: "x\ud800" }],
      ["context lone surrogate", ADVISOR_SHAPED_PLAN, { ...VALID_BRIEF, context: { ...CONTEXT, fields: [...CONTEXT.fields.slice(0, 5), { id: "constraints", state: "known", value: "\ud800" }] } }],
      ["not approved", { ...ADVISOR_SHAPED_PLAN, decisions: [] }, VALID_BRIEF],
      ["plan unknown field", { ...ADVISOR_SHAPED_PLAN, extra: 1 } as unknown as AdvisorPlan, VALID_BRIEF],
      ["brief unknown field", ADVISOR_SHAPED_PLAN, { ...VALID_BRIEF, extra: 1 } as unknown as EngagementBrief],
    ];
    for (const [name, plan, brief] of refusals) {
      const host = fakeHost();
      let result: ReturnType<typeof applyEngagementBrief> | undefined;
      expect(() => {
        result = applyEngagementBrief(host, "/repo", plan, brief, "clossys/brief.json");
      }, name).not.toThrow();
      expect(result?.state, name).toBe("refused");
      expect(Object.keys(host.written), name).toHaveLength(0);
    }
  });

  it("writes clossys/brief.json byte-identically from the validated brief when both pass", () => {
    const host = fakeHost();
    const result = applyEngagementBrief(host, "/repo", VALID_PLAN, VALID_BRIEF, "clossys/brief.json");
    expect(result.state).toBe("applied");
    expect((result as { path: string }).path).toBe("/repo/clossys/brief.json");
    expect(JSON.parse(host.written["/repo/clossys/brief.json"] as string)).toEqual(VALID_BRIEF);
    expect(host.written["/repo/clossys/brief.json"]?.endsWith("\n")).toBe(true);
  });
});
