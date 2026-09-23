import { describe, expect, it } from "vitest";
import { renderAdvisorStatus } from "./index.js";
import type { AdvisorPlan } from "./index.js";

const BASE_PLAN: AdvisorPlan = {
  schemaVersion: 1,
  asOf: "2026-09-22T00:00:00Z",
  mandate: { problem: "Our site doesn't explain what we do.", primaryProblemId: "strategist-unclear-direction", roles: ["strategist", "writer"] },
  whereWeAre: ["Fit and readiness both satisfied."],
  recommendedNext: { action: "Approve the first-wave plan.", owner: "sponsor", due: "2026-09-29T00:00:00Z" },
  decisions: [{ at: "2026-09-20T00:00:00Z", recommended: "compose from confirmed problems", chosen: "approved", by: "sponsor" }],
  blockers: [{ kind: "missing-authority", description: "No sponsor grant yet.", owner: "sponsor", dueDate: "2026-09-25T00:00:00Z" }],
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

  it("a blocker line names its kind, description, owner, and due date", () => {
    const markdown = renderAdvisorStatus(BASE_PLAN);
    expect(markdown).toContain("[missing-authority] No sponsor grant yet. (owner: sponsor, due 2026-09-25T00:00:00Z)");
  });

  it("is deterministic: rendering the same plan twice gives byte-identical output", () => {
    expect(renderAdvisorStatus(BASE_PLAN)).toBe(renderAdvisorStatus(BASE_PLAN));
  });
});
