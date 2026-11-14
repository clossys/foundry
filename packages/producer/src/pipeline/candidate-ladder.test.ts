import { describe, expect, it } from "vitest";
import { DESIGNER_RUNG_KIND, GENERIC_RUNGS, ladderIssues, rungKind, rungsOf } from "./candidate-ladder.js";

describe("candidate ladder rungs (R03.1)", () => {
  it("the generic rungs are adopt, adapt and create, in order", () => {
    expect(GENERIC_RUNGS).toEqual(["adopt", "adapt", "create"]);
    expect(rungsOf("writer")).toEqual(["adopt", "adapt", "create"]);
  });
  it("Designer L1 and L2 adopt, L3 adapts, L4 creates", () => {
    expect(DESIGNER_RUNG_KIND).toEqual({ L1: "adopt", L2: "adopt", L3: "adapt", L4: "create" });
    expect(rungKind("designer", "L2")).toBe("adopt");
    expect(rungKind("director", "adopt")).toBe("adopt");
  });
  it("select is no rung", () => {
    expect(rungKind("writer", "select")).toBeNull();
    expect(ladderIssues("writer", { rung: "select", seed: "x" }).map(issue => issue.rule)).toEqual(["ladder-fields"]);
  });
  it("adopt and adapt name a seed; create names a reason", () => {
    expect(ladderIssues("director", { rung: "adopt", seed: "director/brief.identity/identity-v1" })).toEqual([]);
    expect(ladderIssues("director", { rung: "adopt" })).toEqual([{ rule: "ladder-fields", detail: "rung adopt (adopt) names the seed it adopted" }]);
    expect(ladderIssues("publisher", { rung: "adapt" }).map(issue => issue.detail)).toEqual(["rung adapt (adapt) names the seed it adapted"]);
    expect(ladderIssues("writer", { rung: "create" }).map(issue => issue.rule)).toEqual(["create-justification"]);
    expect(ladderIssues("writer", { rung: "create", reason: "no template covers it" })).toEqual([]);
  });
});
