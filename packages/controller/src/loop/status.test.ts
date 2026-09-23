import { describe, expect, it } from "vitest";
import { renderLoopStatus, renderStatusDocument } from "./status.js";
import type { LoopState } from "./types.js";

describe("generic status document renderer", () => {
  it("renders exactly five sections, in the fixed order, with the caller's own bodies", () => {
    const doc = renderStatusDocument("@clossys/advisor", {
      mandate: "Confirm client problems.",
      whereWeAre: "Two capabilities drafted.",
      recommendedNext: "Approve the composed kit.",
      decisions: "None yet.",
      blockers: "None.",
    });
    const headings = doc.match(/^## .+$/gm);
    expect(headings).toEqual(["## Mandate", "## Where we are", "## Recommended next", "## Decisions", "## Blockers"]);
    expect(doc).toContain("Confirm client problems.");
    expect(doc).toContain("Approve the composed kit.");
  });

  it("is generic over the caller: Advisor's own section bodies render with the identical structure Controller's loop state does", () => {
    const advisorStyle = renderStatusDocument("@clossys/advisor", {
      mandate: "m",
      whereWeAre: "w",
      recommendedNext: "r",
      decisions: "d",
      blockers: "b",
    });
    const loopState: LoopState = { schemaVersion: 1, role: "@clossys/controller", capabilities: {} };
    const controllerStyle = renderLoopStatus("@clossys/controller", loopState, "m");
    const sameHeadingShape = (doc: string) => doc.match(/^## .+$/gm);
    expect(sameHeadingShape(advisorStyle)).toEqual(sameHeadingShape(controllerStyle));
  });

  it("prints a placeholder rather than an empty section", () => {
    const doc = renderStatusDocument("@clossys/advisor", { mandate: "m", whereWeAre: "", recommendedNext: "", decisions: "", blockers: "" });
    expect(doc).toContain("Nothing recorded.");
  });
});

describe("loop status rendering", () => {
  function stateWith(overrides: Partial<LoopState["capabilities"][string]> = {}): LoopState {
    return {
      schemaVersion: 1,
      role: "@clossys/advisor",
      capabilities: {
        "confirm-problems": {
          id: "confirm-problems",
          state: "draft",
          condition: "current",
          stage: "judge",
          inputFingerprints: {},
          lastWrittenFingerprints: {},
          blockers: [],
          decisions: [],
          ...overrides,
        },
      },
    };
  }

  it("lists every capability's state, condition, and stage under Where we are", () => {
    const doc = renderLoopStatus("@clossys/advisor", stateWith(), "Confirm client problems.");
    expect(doc).toContain("**confirm-problems** — draft (current), at `judge`");
  });

  it("recommends next only for capabilities with no open blocker", () => {
    const blocked = stateWith({
      blockers: [{ capabilityId: "confirm-problems", kind: "missing-input", owner: "upstream-role-or-client", nextAction: { who: "client", how: "answer intake", byWhen: "2026-10-01" }, since: "2026-09-22T00:00:00Z" }],
    });
    const doc = renderLoopStatus("@clossys/advisor", blocked, "m");
    expect(doc).toContain("Nothing unblocked is waiting on a next step.");
  });

  it("marks an overdue blocker distinctly from one still on schedule", () => {
    const state = stateWith({
      blockers: [{ capabilityId: "confirm-problems", kind: "missing-authority", owner: "sponsor", nextAction: { who: "sponsor", how: "grant authority", byWhen: "2026-09-01" }, since: "2026-08-20T00:00:00Z" }],
    });
    const doc = renderLoopStatus("@clossys/advisor", state, "m", new Date("2026-09-22T00:00:00Z"));
    expect(doc).toContain("OVERDUE");
  });

  it("lists decisions in chronological order across capabilities", () => {
    const state: LoopState = {
      schemaVersion: 1,
      role: "@clossys/advisor",
      capabilities: {
        b: { id: "b", state: "draft", condition: "current", stage: "judge", inputFingerprints: {}, lastWrittenFingerprints: {}, blockers: [], decisions: [{ recommended: "x", chosen: "x", when: "2026-09-20T00:00:00Z" }] },
        a: { id: "a", state: "draft", condition: "current", stage: "judge", inputFingerprints: {}, lastWrittenFingerprints: {}, blockers: [], decisions: [{ recommended: "y", chosen: "y", when: "2026-09-21T00:00:00Z" }] },
      },
    };
    const doc = renderLoopStatus("@clossys/advisor", state, "m");
    expect(doc.indexOf("2026-09-20")).toBeLessThan(doc.indexOf("2026-09-21"));
  });
});
