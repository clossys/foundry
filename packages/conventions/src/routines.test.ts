import { describe, expect, it } from "vitest";
import {
  reconciliationFindingKinds,
  validateRoutineDeclaration,
  validateRoutineSet,
  validateScheduledSkillDescription,
} from "./routines.js";
import type { RoutineDeclaration, RoutineRegistry } from "./types.js";

const registry: RoutineRegistry = {
  repositories: ["owned-one", "owned-two"],
  skills: ["ex-audit-dependencies", "ex-review-protocols"],
  cadences: ["daily", "weekly", "monthly"],
  modes: ["report-only", "propose", "apply"],
};

const valid: RoutineDeclaration = {
  id: "dependency-audit",
  skill: "ex-audit-dependencies",
  cadence: "weekly",
  scope: ["owned-one"],
  mode: "report-only",
  purpose: "Surface dependency drift before it becomes a forced upgrade.",
};

describe("validateRoutineDeclaration", () => {
  it("accepts a well-formed declaration", () => {
    expect(validateRoutineDeclaration(valid, registry)).toEqual([]);
  });

  it("requires every field", () => {
    for (const field of ["id", "skill", "cadence", "scope", "mode", "purpose"]) {
      const declaration = { ...valid, [field]: undefined } as unknown as RoutineDeclaration;
      const findings = validateRoutineDeclaration(declaration, registry);
      expect(findings.map((f) => f.rule), field).toContain("routine/missing-field");
    }
  });

  it("treats an empty scope as missing rather than as a wildcard", () => {
    const findings = validateRoutineDeclaration({ ...valid, scope: [] }, registry);
    expect(findings.map((f) => f.rule)).toContain("routine/missing-field");
  });

  it("rejects a cadence or mode outside the plane's declared lists", () => {
    expect(
      validateRoutineDeclaration({ ...valid, cadence: "hourly" }, registry).map((f) => f.rule),
    ).toContain("routine/unknown-cadence");
    expect(
      validateRoutineDeclaration({ ...valid, mode: "autonomous" }, registry).map((f) => f.rule),
    ).toContain("routine/unknown-mode");
  });

  it("rejects a target that does not resolve to a skill this plane owns", () => {
    const findings = validateRoutineDeclaration({ ...valid, skill: "some-runbook" }, registry);
    expect(findings.map((f) => f.rule)).toContain("routine/unresolvable-skill");
  });

  it("defers a governed repository-owned target to capability registry resolution", () => {
    const findings = validateRoutineDeclaration({
      ...valid,
      skill: "ex-audit-repository",
      skillRepository: "owned-two",
    }, registry);
    expect(findings).toEqual([]);
  });

  it("does not weaken plane-root resolution for an unqualified target", () => {
    const findings = validateRoutineDeclaration({
      ...valid,
      skill: "ex-audit-repository",
    }, registry);
    expect(findings.map((f) => f.rule)).toContain("routine/unresolvable-skill");
  });

  it("rejects a repository-owned target outside the declaring plane", () => {
    const findings = validateRoutineDeclaration({
      ...valid,
      skill: "ex-audit-repository",
      skillRepository: "outside-plane",
    }, registry);
    expect(findings.map((f) => f.rule)).toContain("routine/skill-repository-outside-plane");
  });

  // Scope is closed with no escape hatch, deliberately not even a declared one.
  it("rejects a scope reaching outside the declaring plane", () => {
    const findings = validateRoutineDeclaration({ ...valid, scope: ["someone-elses"] }, registry);
    expect(findings.map((f) => f.rule)).toContain("routine/scope-outside-plane");
  });

  it("rejects an absolute path frozen into the declaration", () => {
    const findings = validateRoutineDeclaration(
      { ...valid, purpose: "Run against /srv/checkout every week." },
      registry,
    );
    expect(findings.map((f) => f.rule)).toContain("routine/absolute-path");
  });
});

describe("validateRoutineSet", () => {
  it("reports a duplicate identifier", () => {
    const findings = validateRoutineSet([valid, valid], registry);
    expect(findings.map((f) => f.rule)).toContain("routine/duplicate-id");
  });

  it("reports an exclusion recorded without a reason", () => {
    const findings = validateRoutineSet([valid], registry, {
      exclusions: [{ skill: "ex-review-protocols", reason: "" }],
    });
    expect(findings.map((f) => f.rule)).toContain("routine/exclusion-without-reason");
  });

  it("accepts an exclusion that records why", () => {
    const findings = validateRoutineSet([valid], registry, {
      exclusions: [{ skill: "ex-review-protocols", reason: "Run on demand; upstream changes are announced." }],
    });
    expect(findings).toEqual([]);
  });
});

describe("validateScheduledSkillDescription", () => {
  it("accepts a description that says it is not conversationally triggered", () => {
    expect(
      validateScheduledSkillDescription(
        "ex-audit-dependencies",
        "Audit dependency freshness. Scheduled only; not conversationally triggered.",
      ),
    ).toEqual([]);
  });

  it("reports a scheduled skill that competes for ordinary invocation", () => {
    const findings = validateScheduledSkillDescription(
      "ex-audit-dependencies",
      "Audit dependency freshness across the plane.",
    );
    expect(findings.map((f) => f.rule)).toContain("routine/skill-not-marked-scheduled");
  });
});

describe("reconciliationFindingKinds", () => {
  // Exported as data, not implemented: this package cannot read a scheduler's
  // store, and a check that tried would pass in CI for the opposite reason it
  // passes locally.
  it("names the registered-body case, which nothing in a checkout can see", () => {
    expect(reconciliationFindingKinds).toContain("registered-body-is-not-a-plain-skill-invocation");
    expect(reconciliationFindingKinds).toHaveLength(4);
  });
});
