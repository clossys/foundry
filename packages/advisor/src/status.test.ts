import { describe, expect, it } from "vitest";
import { ADVISOR_BLOCKER_KINDS, renderAdvisorStatus, validateAdvisorPlan } from "./index.js";
import type { AdvisorPlan, AdvisorPlanBlocker } from "./index.js";

const BLOCKER: AdvisorPlanBlocker = {
  capabilityId: "engagement",
  kind: "missing-authority",
  owner: "sponsor",
  nextAction: { who: "sponsor", how: "approve the plan", byWhen: "2026-09-25T00:00:00Z" },
  since: "2026-09-20T00:00:00Z",
};

const BASE_PLAN: AdvisorPlan = {
  schemaVersion: 1,
  asOf: "2026-09-22T00:00:00Z",
  mandate: { problem: "Our site doesn't explain what we do.", primaryProblemId: "strategist-unclear-direction", roles: ["strategist", "writer"] },
  whereWeAre: ["Fit and readiness both satisfied."],
  recommendedNext: { action: "Approve the first-wave plan.", owner: "sponsor", due: "2026-09-29T00:00:00Z" },
  decisions: [{ at: "2026-09-20T00:00:00Z", recommended: "compose from confirmed problems", chosen: "approved", by: "sponsor" }],
  blockers: [BLOCKER],
};

describe("renderAdvisorStatus (issue #1175)", () => {
  it("renders exactly the five fixed sections, in order", () => {
    const markdown = renderAdvisorStatus(BASE_PLAN);
    const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual(["Mandate", "Where we are", "Recommended next", "Decisions", "Blockers"]);
  });

  it("Mandate carries the problem and staffed roles", () => {
    const markdown = renderAdvisorStatus(BASE_PLAN);
    expect(markdown).toContain("Our site doesn't explain what we do.");
    expect(markdown).toContain("Staffed roles: strategist, writer.");
  });

  it("Recommended next renders null as 'Nothing pending.'", () => {
    const markdown = renderAdvisorStatus({ ...BASE_PLAN, recommendedNext: null });
    expect(markdown).toContain("Nothing pending.");
  });

  it("empty decisions and blockers render their own placeholder text, never a blank section", () => {
    const markdown = renderAdvisorStatus({ ...BASE_PLAN, decisions: [], blockers: [] });
    expect(markdown).toContain("None recorded yet.");
    expect(markdown).toContain("None.");
  });

  it("a blocker line names its capability, kind, next action, owner, and since -- the shared Controller Blocker shape (#1237)", () => {
    const markdown = renderAdvisorStatus(BASE_PLAN);
    expect(markdown).toContain("- [missing-authority] engagement — next: sponsor approve the plan by 2026-09-25T00:00:00Z (owner: sponsor, since 2026-09-20T00:00:00Z)");
  });

  it("is deterministic: rendering the same plan twice gives byte-identical output", () => {
    expect(renderAdvisorStatus(BASE_PLAN)).toBe(renderAdvisorStatus(BASE_PLAN));
  });
});

describe("validateAdvisorPlan (blocker shape shared with Controller's loop.json Blocker, #1237)", () => {
  it("a well-formed plan has no findings", () => {
    expect(validateAdvisorPlan(BASE_PLAN)).toEqual([]);
  });

  it("rejects a non-object", () => {
    expect(validateAdvisorPlan("not a plan").length).toBeGreaterThan(0);
    expect(validateAdvisorPlan(null).length).toBeGreaterThan(0);
  });

  it("rejects a blocker missing capabilityId, owner, since, or nextAction", () => {
    const blocker = { kind: "missing-input" };
    const findings = validateAdvisorPlan({ ...BASE_PLAN, blockers: [blocker] });
    const paths = findings.map((finding) => finding.path);
    expect(paths).toContain("blockers[0].capabilityId");
    expect(paths).toContain("blockers[0].owner");
    expect(paths).toContain("blockers[0].since");
    expect(paths).toContain("blockers[0].nextAction");
    expect(findings.every((finding) => finding.rule === "advisor-plan-contract")).toBe(true);
  });

  it("rejects an old-shape blocker (description/dueDate) the same way -- it has no capabilityId, owner is present but nextAction/since are missing, and its extra fields are refused", () => {
    const oldShapeBlocker = { kind: "missing-input", description: "no evidence yet", owner: "this-role", dueDate: "2026-09-25T00:00:00Z" };
    const findings = validateAdvisorPlan({ ...BASE_PLAN, blockers: [oldShapeBlocker] });
    const paths = findings.map((finding) => finding.path);
    expect(paths).toContain("blockers[0].capabilityId");
    expect(paths).toContain("blockers[0].since");
    expect(paths).toContain("blockers[0].nextAction");
    expect(paths).toContain("blockers[0].description");
    expect(paths).toContain("blockers[0].dueDate");
  });

  it("rejects a nextAction missing who, how, or byWhen", () => {
    const blocker = { ...BLOCKER, nextAction: { who: "sponsor" } };
    const findings = validateAdvisorPlan({ ...BASE_PLAN, blockers: [blocker] });
    const paths = findings.map((finding) => finding.path);
    expect(paths).toContain("blockers[0].nextAction.how");
    expect(paths).toContain("blockers[0].nextAction.byWhen");
  });

  it("rejects a kind outside the five values #1195/#1237 declare", () => {
    const blocker = { ...BLOCKER, kind: "some-other-kind" };
    const findings = validateAdvisorPlan({ ...BASE_PLAN, blockers: [blocker] });
    expect(findings.some((finding) => finding.path === "blockers[0].kind")).toBe(true);
  });

  it("ADVISOR_BLOCKER_KINDS is exactly Controller's own five, same order (kinds agree; only the record shape was locally divergent)", () => {
    expect(ADVISOR_BLOCKER_KINDS).toEqual(["missing-input", "missing-authority", "failing-evidence", "unavailable-environment", "contradiction"]);
  });
});
