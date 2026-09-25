import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyEngagementBrief, isPlanApproved, validateAdvisorPlan, validateEngagementBrief, type AdvisorPlan, type EngagementBrief, type EngagementContext } from "./apply-plan.js";
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

  it("refuses a field the brief contract does not declare", () => {
    expect(validateEngagementBrief({ ...VALID_BRIEF, notes: "x" })).toEqual({
      valid: false,
      reason: "brief.notes is not a field the contract declares, and unknown fields are refused",
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
      "plan.blockers[0].description is not a field the contract declares, and unknown fields are refused",
      "plan.blockers[0].dueDate is not a field the contract declares, and unknown fields are refused",
    ]) expect(reason).toContain(expected);
  });

  it("rejects a blocker with an unrecognized kind", () => {
    const plan = { ...ADVISOR_SHAPED_PLAN, blockers: [{ ...ADVISOR_SHAPED_PLAN.blockers[0], kind: "something-else" }] };
    expect(validateAdvisorPlan(plan)).toEqual({
      valid: false,
      reason: 'plan.blockers[0].kind must be one of: "missing-input", "missing-authority", "failing-evidence", "unavailable-environment", "contradiction"',
    });
  });

  it("refuses an unknown field nested in the plan", () => {
    const plan = { ...VALID_PLAN, mandate: { ...VALID_PLAN.mandate, owner: "x" } };
    expect(validateAdvisorPlan(plan)).toEqual({ valid: false, reason: "plan.mandate.owner is not a field the contract declares, and unknown fields are refused" });
  });

  it("refuses a decision whose time is not an ISO 8601 date-time", () => {
    const plan = { ...VALID_PLAN, decisions: [{ ...VALID_PLAN.decisions[0]!, at: "last week" }] };
    expect(validateAdvisorPlan(plan)).toEqual({ valid: false, reason: "plan.decisions[0].at must be an ISO 8601 date-time with a time zone, such as 2026-09-24T12:00:00Z" });
  });

  it("rejects a decision missing any of its four required fields", () => {
    const plan = { ...VALID_PLAN, decisions: [{ at: "2026-09-20T00:00:00Z", recommended: "x", chosen: "approved" }] };
    expect(validateAdvisorPlan(plan)).toEqual({ valid: false, reason: "plan.decisions[0].by is required" });
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
    const result = applyEngagementBrief(host, "/repo", { ...VALID_PLAN, staffing: [] } as unknown as AdvisorPlan, VALID_BRIEF, "clossys/brief.json");
    expect(result).toEqual({ state: "refused", reason: "plan does not validate: plan.staffing is not a field the contract declares, and unknown fields are refused" });
    expect(Object.keys(host.written)).toHaveLength(0);
  });

  it("applies an Advisor-shaped plan with blockers and a brief with context, and reports the plan's canonical digest", () => {
    const host = fakeHost();
    const brief = { ...VALID_BRIEF, context: CONTEXT };
    const result = applyEngagementBrief(host, "/repo", ADVISOR_SHAPED_PLAN, brief, "clossys/brief.json");
    expect(result).toEqual({ state: "applied", path: "/repo/clossys/brief.json", planDigest: corpusPlan("blockers-without-due").digest });
    expect(JSON.parse(host.written["/repo/clossys/brief.json"] as string)).toEqual(brief);
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
