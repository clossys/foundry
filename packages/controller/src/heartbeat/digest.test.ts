import { describe, expect, it } from "vitest";
import { computeHeartbeat, renderDigest } from "./digest.js";
import type { LoopState } from "../loop/types.js";

const NOW = new Date("2026-09-23T12:00:00Z");

function state(role: string, capabilities: LoopState["capabilities"]): LoopState {
  return { schemaVersion: 1, role, capabilities };
}

describe("computeHeartbeat", () => {
  it("returns no entries for roles with nothing waiting", () => {
    const roles = { advisor: state("advisor", { c1: { id: "c1", state: "verified", condition: "current", stage: null, inputFingerprints: {}, lastWrittenFingerprints: {}, blockers: [], decisions: [] } }) };
    const digest = computeHeartbeat(roles, NOW);
    expect(digest.entries).toEqual([]);
    expect(digest.generatedAt).toBe(NOW.toISOString());
  });

  it("finds a blocked capability, carrying overdue-ness from the blocker's own byWhen", () => {
    const roles = {
      advisor: state("advisor", {
        c1: {
          id: "c1",
          state: "draft",
          condition: "current",
          stage: "act",
          inputFingerprints: {},
          lastWrittenFingerprints: {},
          blockers: [{ capabilityId: "c1", kind: "missing-input", owner: "upstream-role-or-client", since: "2026-09-01T00:00:00Z", nextAction: { who: "sponsor", how: "approve the brief", byWhen: "2026-09-10T00:00:00Z" } }],
          decisions: [],
        },
      }),
    };
    const digest = computeHeartbeat(roles, NOW);
    expect(digest.entries).toHaveLength(1);
    expect(digest.entries[0]).toMatchObject({ role: "advisor", capabilityId: "c1", kind: "blocked-capability", overdue: true, byWhen: "2026-09-10T00:00:00Z" });
  });

  it("finds a pending decision (stage judge), a stale capability, and a review-waiting capability (stage learn)", () => {
    const roles = {
      advisor: state("advisor", {
        judging: { id: "judging", state: "draft", condition: "current", stage: "judge", inputFingerprints: {}, lastWrittenFingerprints: {}, blockers: [], decisions: [] },
        stale: { id: "stale", state: "approved", condition: "stale", stage: "sense", inputFingerprints: {}, lastWrittenFingerprints: {}, blockers: [], decisions: [] },
        learning: { id: "learning", state: "verified", condition: "current", stage: "learn", inputFingerprints: {}, lastWrittenFingerprints: {}, blockers: [], decisions: [] },
      }),
    };
    const digest = computeHeartbeat(roles, NOW);
    const kinds = digest.entries.map((e) => e.kind).sort();
    expect(kinds).toEqual(["pending-decision", "review-waiting", "stale-capability"]);
  });

  it("sorts overdue blockers first, then pending decisions, then non-overdue blockers, then stale, then review-waiting", () => {
    const roles = {
      advisor: state("advisor", {
        stale: { id: "stale", state: "approved", condition: "stale", stage: "sense", inputFingerprints: {}, lastWrittenFingerprints: {}, blockers: [], decisions: [] },
        learning: { id: "learning", state: "verified", condition: "current", stage: "learn", inputFingerprints: {}, lastWrittenFingerprints: {}, blockers: [], decisions: [] },
        judging: { id: "judging", state: "draft", condition: "current", stage: "judge", inputFingerprints: {}, lastWrittenFingerprints: {}, blockers: [], decisions: [] },
        notOverdue: {
          id: "notOverdue",
          state: "draft",
          condition: "current",
          stage: "act",
          inputFingerprints: {},
          lastWrittenFingerprints: {},
          blockers: [{ capabilityId: "notOverdue", kind: "missing-input", owner: "upstream-role-or-client", since: "2026-09-20T00:00:00Z", nextAction: { who: "sponsor", how: "approve", byWhen: "2026-10-01T00:00:00Z" } }],
          decisions: [],
        },
        overdue: {
          id: "overdue",
          state: "draft",
          condition: "current",
          stage: "act",
          inputFingerprints: {},
          lastWrittenFingerprints: {},
          blockers: [{ capabilityId: "overdue", kind: "missing-authority", owner: "sponsor", since: "2026-09-01T00:00:00Z", nextAction: { who: "sponsor", how: "sign off", byWhen: "2026-09-05T00:00:00Z" } }],
          decisions: [],
        },
      }),
    };
    const digest = computeHeartbeat(roles, NOW);
    expect(digest.entries.map((e) => `${e.kind}:${e.capabilityId}`)).toEqual(["blocked-capability:overdue", "pending-decision:judging", "blocked-capability:notOverdue", "stale-capability:stale", "review-waiting:learning"]);
  });

  it("ties within a group are broken by role then capabilityId, for determinism", () => {
    const roles = {
      beta: state("beta", { a: { id: "a", state: "draft", condition: "current", stage: "judge", inputFingerprints: {}, lastWrittenFingerprints: {}, blockers: [], decisions: [] } }),
      alpha: state("alpha", { b: { id: "b", state: "draft", condition: "current", stage: "judge", inputFingerprints: {}, lastWrittenFingerprints: {}, blockers: [], decisions: [] } }),
    };
    const digest = computeHeartbeat(roles, NOW);
    expect(digest.entries.map((e) => e.role)).toEqual(["alpha", "beta"]);
  });
});

describe("renderDigest", () => {
  it("renders a plain one-line message when nothing is waiting, never an empty file", () => {
    const rendered = renderDigest([], NOW);
    expect(rendered).toContain("Nothing is waiting on you right now.");
    expect(rendered.trim().length).toBeGreaterThan(0);
  });

  it("renders one line per entry, marking overdue blockers", () => {
    const rendered = renderDigest(
      [
        { role: "advisor", capabilityId: "c1", kind: "blocked-capability", detail: "missing-input: approve the brief (owner: upstream-role-or-client)", since: "2026-09-01T00:00:00Z", byWhen: "2026-09-10T00:00:00Z", overdue: true },
        { role: "advisor", capabilityId: "c2", kind: "pending-decision", detail: "c2 is waiting on a judge-stage decision." },
      ],
      NOW,
    );
    expect(rendered).toContain("advisor / c1");
    expect(rendered).toContain("OVERDUE");
    expect(rendered).toContain("advisor / c2");
    expect(rendered).toContain("Pending decision");
  });
});
