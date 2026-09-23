import { describe, expect, it } from "vitest";
import { applyEngagementBrief, isPlanApproved, validateAdvisorPlan, validateEngagementBrief, type AdvisorPlan, type EngagementBrief } from "./apply-plan.js";
import type { WorkspaceHost } from "./types.js";

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

  it("rejects a goal.direction that is not increase or decrease", () => {
    const broken = { ...VALID_BRIEF, roles: [{ ...VALID_BRIEF.roles[0], goal: { metric: "x", direction: "sideways" } }] };
    expect(validateEngagementBrief(broken).valid).toBe(false);
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

  it("rejects a blocker with an unrecognized kind", () => {
    const plan = { ...VALID_PLAN, blockers: [{ kind: "something-else", description: "x", owner: "y" }] };
    expect(validateAdvisorPlan(plan).valid).toBe(false);
  });

  it("rejects a decision missing any of its four required fields", () => {
    const plan = { ...VALID_PLAN, decisions: [{ at: "2026-09-20T00:00:00Z", recommended: "x", chosen: "approved" }] };
    expect(validateAdvisorPlan(plan).valid).toBe(false);
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

  it("writes clossys/brief.json byte-identically from the validated brief when both pass", () => {
    const host = fakeHost();
    const result = applyEngagementBrief(host, "/repo", VALID_PLAN, VALID_BRIEF, "clossys/brief.json");
    expect(result.state).toBe("applied");
    expect((result as { path: string }).path).toBe("/repo/clossys/brief.json");
    expect(JSON.parse(host.written["/repo/clossys/brief.json"] as string)).toEqual(VALID_BRIEF);
    expect(host.written["/repo/clossys/brief.json"]?.endsWith("\n")).toBe(true);
  });
});
