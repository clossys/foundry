import { describe, expect, it } from "vitest";
import { BLOCKER_KINDS } from "./types.js";
import { blockerFor, isBlockerOverdue, overdueBlockers } from "./blockers.js";

describe("blocker construction", () => {
  it("derives the owner from the kind, one fixed owner per kind, never caller-supplied", () => {
    expect(blockerFor("cap-1", "missing-input", { who: "advisor", how: "confirm the brief", byWhen: "2026-10-01" }, "2026-09-22T00:00:00Z").owner).toBe(
      "upstream-role-or-client",
    );
    expect(blockerFor("cap-1", "missing-authority", { who: "sponsor", how: "grant authority", byWhen: "2026-10-01" }, "2026-09-22T00:00:00Z").owner).toBe(
      "sponsor",
    );
    expect(blockerFor("cap-1", "failing-evidence", { who: "this-role", how: "re-run", byWhen: "2026-10-01" }, "2026-09-22T00:00:00Z").owner).toBe(
      "this-role",
    );
    expect(
      blockerFor("cap-1", "unavailable-environment", { who: "ops", how: "restore access", byWhen: "2026-10-01" }, "2026-09-22T00:00:00Z").owner,
    ).toBe("named-system-owner");
    expect(blockerFor("cap-1", "contradiction", { who: "advisor", how: "reconcile", byWhen: "2026-10-01" }, "2026-09-22T00:00:00Z").owner).toBe(
      "advisor",
    );
  });

  it("covers every declared blocker kind with a fixed owner", () => {
    for (const kind of BLOCKER_KINDS) {
      const blocker = blockerFor("cap-1", kind, { who: "x", how: "y", byWhen: "2026-10-01" }, "2026-09-22T00:00:00Z");
      expect(blocker.owner).toBeTruthy();
    }
  });

  it("rests with exactly one next action", () => {
    const blocker = blockerFor("cap-1", "missing-input", { who: "advisor", how: "confirm", byWhen: "2026-10-01" }, "2026-09-22T00:00:00Z");
    expect(Object.keys(blocker.nextAction)).toEqual(["who", "how", "byWhen"]);
  });
});

describe("blocker escalation", () => {
  it("is not overdue before its due date", () => {
    const blocker = blockerFor("cap-1", "missing-input", { who: "advisor", how: "confirm", byWhen: "2026-10-01" }, "2026-09-22T00:00:00Z");
    expect(isBlockerOverdue(blocker, new Date("2026-09-25T00:00:00Z"))).toBe(false);
  });

  it("is overdue after its due date", () => {
    const blocker = blockerFor("cap-1", "missing-input", { who: "advisor", how: "confirm", byWhen: "2026-10-01" }, "2026-09-22T00:00:00Z");
    expect(isBlockerOverdue(blocker, new Date("2026-10-02T00:00:00Z"))).toBe(true);
  });

  it("treats an unparseable due date as already overdue rather than on schedule", () => {
    const blocker = blockerFor("cap-1", "missing-input", { who: "advisor", how: "confirm", byWhen: "not-a-date" }, "2026-09-22T00:00:00Z");
    expect(isBlockerOverdue(blocker, new Date("2026-09-22T00:00:00Z"))).toBe(true);
  });

  it("filters to only overdue blockers across capabilities, leaving each one naming its own capability", () => {
    const onTime = blockerFor("cap-1", "missing-input", { who: "advisor", how: "confirm", byWhen: "2026-12-01" }, "2026-09-22T00:00:00Z");
    const late = blockerFor("cap-2", "failing-evidence", { who: "this-role", how: "re-run", byWhen: "2026-09-01" }, "2026-08-20T00:00:00Z");
    const result = overdueBlockers([onTime, late], new Date("2026-09-22T00:00:00Z"));
    expect(result).toEqual([late]);
    expect(result[0]!.capabilityId).toBe("cap-2");
  });
});
