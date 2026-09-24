import { describe, expect, it } from "vitest";
import { isValidLoopState, resumeStage, validateLoopState } from "./state.js";
import type { LoopState } from "./types.js";

function validState(): LoopState {
  return {
    schemaVersion: 1,
    role: "@clossys/advisor",
    capabilities: {
      "confirm-problems": {
        id: "confirm-problems",
        state: "draft",
        condition: "current",
        stage: "judge",
        inputFingerprints: { "clossys/advisor/intake.json": "abc123" },
        lastWrittenFingerprints: { "clossys/advisor/brief.json": "def456" },
        blockers: [],
        decisions: [{ recommended: "compose kit A", chosen: "compose kit A", when: "2026-09-22T00:00:00Z" }],
      },
    },
  };
}

describe("loop state validation", () => {
  it("accepts a well-formed document", () => {
    expect(validateLoopState(validState())).toEqual([]);
    expect(isValidLoopState(validState())).toBe(true);
  });

  it("rejects anything but schemaVersion 1", () => {
    const state = { ...validState(), schemaVersion: 2 };
    const findings = validateLoopState(state);
    expect(findings.some((f) => f.rule === "invalid-schema-version")).toBe(true);
  });

  it("rejects a capability whose state is not one of the six lifecycle states", () => {
    const state = validState();
    const broken = { ...state, capabilities: { ...state.capabilities, "confirm-problems": { ...state.capabilities["confirm-problems"]!, state: "in-review" } } };
    const findings = validateLoopState(broken);
    expect(findings.some((f) => f.rule === "invalid-lifecycle-state")).toBe(true);
  });

  it("rejects a capability whose condition is not current, stale, or blocked", () => {
    const state = validState();
    const broken = { ...state, capabilities: { ...state.capabilities, "confirm-problems": { ...state.capabilities["confirm-problems"]!, condition: "fresh" } } };
    expect(validateLoopState(broken).some((f) => f.rule === "invalid-lifecycle-condition")).toBe(true);
  });

  it("rejects a nonzero stage when the state is absent or retired -- nothing to resume", () => {
    const state = validState();
    const broken = { ...state, capabilities: { ...state.capabilities, "confirm-problems": { ...state.capabilities["confirm-problems"]!, state: "absent", stage: "judge" } } };
    expect(validateLoopState(broken).some((f) => f.rule === "stage-inconsistent-with-state")).toBe(true);
  });

  it("allows a null stage when the state is absent", () => {
    const state = validState();
    const ok = { ...state, capabilities: { ...state.capabilities, "confirm-problems": { ...state.capabilities["confirm-problems"]!, state: "absent", stage: null } } };
    expect(validateLoopState(ok)).toEqual([]);
  });

  it("rejects a capability id that does not match its own key", () => {
    const state = validState();
    const broken = { ...state, capabilities: { ...state.capabilities, "confirm-problems": { ...state.capabilities["confirm-problems"]!, id: "something-else" } } };
    expect(validateLoopState(broken).some((f) => f.rule === "capability-id-mismatch")).toBe(true);
  });

  it("rejects a blocker with an unknown kind", () => {
    const state = validState();
    const broken = {
      ...state,
      capabilities: {
        ...state.capabilities,
        "confirm-problems": {
          ...state.capabilities["confirm-problems"]!,
          blockers: [{ capabilityId: "confirm-problems", kind: "budget-exceeded", owner: "sponsor", nextAction: { who: "x", how: "y", byWhen: "2026-10-01" }, since: "2026-09-22T00:00:00Z" }],
        },
      },
    };
    expect(validateLoopState(broken).some((f) => f.rule === "invalid-blocker-kind")).toBe(true);
  });

  it("rejects a blocker whose next action is missing a field", () => {
    const state = validState();
    const broken = {
      ...state,
      capabilities: {
        ...state.capabilities,
        "confirm-problems": {
          ...state.capabilities["confirm-problems"]!,
          blockers: [{ capabilityId: "confirm-problems", kind: "missing-input", owner: "upstream-role-or-client", nextAction: { who: "x", how: "y" }, since: "2026-09-22T00:00:00Z" }],
        },
      },
    };
    expect(validateLoopState(broken).some((f) => f.rule === "invalid-next-action")).toBe(true);
  });

  it("rejects a blocker whose capabilityId names a different capability than the one it is filed under", () => {
    const state = validState();
    const broken = {
      ...state,
      capabilities: {
        ...state.capabilities,
        "confirm-problems": {
          ...state.capabilities["confirm-problems"]!,
          blockers: [{ capabilityId: "some-other-capability", kind: "missing-input", owner: "upstream-role-or-client", nextAction: { who: "x", how: "y", byWhen: "2026-10-01" }, since: "2026-09-22T00:00:00Z" }],
        },
      },
    };
    expect(validateLoopState(broken).some((f) => f.rule === "blocker-capability-mismatch")).toBe(true);
  });

  it("rejects a blocker whose owner does not match BLOCKER_OWNERS for its kind", () => {
    const state = validState();
    const broken = {
      ...state,
      capabilities: {
        ...state.capabilities,
        "confirm-problems": {
          ...state.capabilities["confirm-problems"]!,
          blockers: [{ capabilityId: "confirm-problems", kind: "missing-input", owner: "the-wrong-owner", nextAction: { who: "x", how: "y", byWhen: "2026-10-01" }, since: "2026-09-22T00:00:00Z" }],
        },
      },
    };
    expect(validateLoopState(broken).some((f) => f.rule === "blocker-owner-mismatch")).toBe(true);
  });

  it("rejects a decision with an unreadable when date", () => {
    const state = validState();
    const broken = {
      ...state,
      capabilities: { ...state.capabilities, "confirm-problems": { ...state.capabilities["confirm-problems"]!, decisions: [{ recommended: "a", chosen: "b", when: "not-a-date" }] } },
    };
    expect(validateLoopState(broken).some((f) => f.rule === "invalid-decision")).toBe(true);
  });

  it("is indeterminate-safe: a non-object at top level produces a finding, never a crash", () => {
    expect(validateLoopState(null)).toHaveLength(1);
    expect(validateLoopState("not an object")).toHaveLength(1);
    expect(validateLoopState([])).toHaveLength(1);
  });
});

describe("resume", () => {
  it("resumes exactly at the capability's own recorded stage", () => {
    const state = validState();
    expect(resumeStage(state.capabilities["confirm-problems"]!)).toBe("judge");
  });

  it("resumes at null (nothing to resume) for an absent capability", () => {
    expect(resumeStage({ ...validState().capabilities["confirm-problems"]!, state: "absent", stage: null })).toBeNull();
  });
});
