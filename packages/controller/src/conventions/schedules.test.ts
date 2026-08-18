import { describe, expect, it } from "vitest";
import {
  isCronExpression,
  scheduleReconciliationFindingKinds,
  validateScheduleDeclaration,
  validateScheduleSet,
} from "./schedules.js";
import type { ScheduleDeclaration, ScheduleRegistry } from "./types.js";

const registry: ScheduleRegistry = {
  repositories: ["owned-one", "owned-two"],
  hosts: ["edge-worker", "ci-runner"],
};

const valid: ScheduleDeclaration = {
  id: "operations-ticker",
  cadence: "*/10 * * * *",
  scope: ["owned-one", "owned-two"],
  executionHost: "edge-worker",
  artifact: "infrastructure/ticker",
  purpose: "Drive the durable runtime's time-based sweeps from an external clock.",
};

describe("isCronExpression", () => {
  it("accepts the shapes a host actually matches", () => {
    for (const cadence of ["*/10 * * * *", "0 2 * * *", "30 9 * * 1", "0 9 1-7 1,4,7,10 1"]) {
      expect(isCronExpression(cadence), cadence).toBe(true);
    }
  });

  it("rejects a word, a wrong field count, and a malformed field", () => {
    for (const cadence of ["weekly", "0 2 * *", "0 2 * * * *", "0 2 * * abc", ""]) {
      expect(isCronExpression(cadence), cadence).toBe(false);
    }
  });
});

describe("validateScheduleDeclaration", () => {
  it("accepts a well-formed declaration", () => {
    expect(validateScheduleDeclaration(valid, registry)).toEqual([]);
  });

  it("requires every field", () => {
    for (const field of ["id", "cadence", "scope", "executionHost", "artifact", "purpose"]) {
      const declaration = { ...valid, [field]: undefined } as unknown as ScheduleDeclaration;
      const findings = validateScheduleDeclaration(declaration, registry);
      expect(findings.map((f) => f.rule), field).toContain("schedule/missing-field");
    }
  });

  it("treats an empty scope as missing rather than as a wildcard", () => {
    const findings = validateScheduleDeclaration({ ...valid, scope: [] }, registry);
    expect(findings.map((f) => f.rule)).toContain("schedule/missing-field");
  });

  it("requires a lowercase kebab-case identifier", () => {
    const findings = validateScheduleDeclaration({ ...valid, id: "Operations_Ticker" }, registry);
    expect(findings.map((f) => f.rule)).toContain("schedule/malformed-id");
  });

  // The tier's defining constraint: a routine may say "weekly" because its
  // scheduler shares the plane. A schedule's host is a stranger.
  it("rejects a cadence word where an expression is required", () => {
    const findings = validateScheduleDeclaration({ ...valid, cadence: "weekly" }, registry);
    expect(findings.map((f) => f.rule)).toContain("schedule/malformed-cadence");
  });

  it("rejects an execution host outside the plane's declared list", () => {
    const findings = validateScheduleDeclaration({ ...valid, executionHost: "somewhere" }, registry);
    expect(findings.map((f) => f.rule)).toContain("schedule/unknown-host");
  });

  it("closes scope to repositories the plane governs", () => {
    const findings = validateScheduleDeclaration({ ...valid, scope: ["a-stranger"] }, registry);
    expect(findings.map((f) => f.rule)).toContain("schedule/scope-outside-plane");
  });

  it("rejects an absolute artifact location", () => {
    const findings = validateScheduleDeclaration(
      { ...valid, artifact: "/opt/service/ticker" },
      registry,
    );
    expect(findings.map((f) => f.rule)).toContain("schedule/absolute-artifact");
  });

  it("rejects an absolute path written into the purpose", () => {
    const findings = validateScheduleDeclaration(
      { ...valid, purpose: "Runs the sweep defined in /etc/service/config." },
      registry,
    );
    expect(findings.map((f) => f.rule)).toContain("schedule/absolute-path");
  });

  it("accepts a cadence its host's trigger list contains", () => {
    const findings = validateScheduleDeclaration(
      { ...valid, hostTriggers: ["*/10 * * * *", "0 2 * * *"] },
      registry,
    );
    expect(findings).toEqual([]);
  });

  // Two copies of one fact. When they disagree the clock fires, no branch
  // matches, and the work silently does not happen.
  it("catches a cadence the host's trigger list does not contain", () => {
    const findings = validateScheduleDeclaration(
      { ...valid, cadence: "*/15 * * * *", hostTriggers: ["*/10 * * * *"] },
      registry,
    );
    expect(findings.map((f) => f.rule)).toContain("schedule/cadence-absent-from-host-triggers");
  });

  it("rejects an empty host trigger list rather than reading it as no table", () => {
    const findings = validateScheduleDeclaration({ ...valid, hostTriggers: [] }, registry);
    expect(findings.map((f) => f.rule)).toContain("schedule/empty-host-triggers");
  });
});

describe("validateScheduleSet", () => {
  it("accepts a set whose declarations claim every trigger their artifact holds", () => {
    const triggers = ["*/10 * * * *", "0 2 * * *"];
    const findings = validateScheduleSet(
      [
        { ...valid, id: "sweep", cadence: "*/10 * * * *", hostTriggers: triggers },
        { ...valid, id: "archive", cadence: "0 2 * * *", hostTriggers: triggers },
      ],
      registry,
    );
    expect(findings).toEqual([]);
  });

  it("rejects a duplicate identifier", () => {
    const findings = validateScheduleSet([valid, { ...valid }], registry);
    expect(findings.map((f) => f.rule)).toContain("schedule/duplicate-id");
  });

  // The set-level rule a single declaration cannot see, and the exact shape of
  // a real silent failure: a trigger nobody claims still reports success.
  it("catches a host trigger that no schedule claims", () => {
    const triggers = ["*/10 * * * *", "0 2 * * *"];
    const findings = validateScheduleSet(
      [{ ...valid, id: "sweep", cadence: "*/10 * * * *", hostTriggers: triggers }],
      registry,
    );
    const unclaimed = findings.filter((f) => f.rule === "schedule/unclaimed-host-trigger");
    expect(unclaimed).toHaveLength(1);
    expect(unclaimed[0].message).toContain("0 2 * * *");
  });

  it("catches schedules on one artifact disagreeing about its trigger table", () => {
    const findings = validateScheduleSet(
      [
        { ...valid, id: "sweep", cadence: "*/10 * * * *", hostTriggers: ["*/10 * * * *"] },
        { ...valid, id: "archive", cadence: "0 2 * * *", hostTriggers: ["0 2 * * *"] },
      ],
      registry,
    );
    expect(findings.map((f) => f.rule)).toContain("schedule/inconsistent-host-triggers");
  });

  it("does not group schedules that merely share a cadence on different artifacts", () => {
    const findings = validateScheduleSet(
      [
        { ...valid, id: "sweep", artifact: "infrastructure/a", hostTriggers: ["*/10 * * * *"] },
        { ...valid, id: "other", artifact: "infrastructure/b", hostTriggers: ["*/10 * * * *"] },
      ],
      registry,
    );
    expect(findings).toEqual([]);
  });

  it("requires a reason on every exclusion", () => {
    const findings = validateScheduleSet([valid], registry, {
      exclusions: [{ id: "retired-sweep", reason: "" }],
    });
    expect(findings.map((f) => f.rule)).toContain("schedule/exclusion-without-reason");
  });
});

describe("scheduleReconciliationFindingKinds", () => {
  it("names the answers only a live probe can give, including deploy drift", () => {
    expect(scheduleReconciliationFindingKinds).toContain("declared-but-not-deployed");
    expect(scheduleReconciliationFindingKinds).toContain(
      "deployed-artifact-predates-its-declaration",
    );
  });
});
