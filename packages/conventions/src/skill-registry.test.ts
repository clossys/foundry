import { describe, expect, it } from "vitest";
import {
  SKILL_REGISTRY_SCHEMA_VERSION,
  validateRoutineSkillCoverage,
  validateSkillRegistry,
} from "./skill-registry.js";
import type {
  SkillRegistryDocument,
  SkillRegistryOptions,
} from "./skill-registry.js";
import type { RoutineDeclaration } from "./types.js";

const options: SkillRegistryOptions = {
  repositories: ["control", "product", "archive"],
  planeRepository: "control",
  prefixes: ["ex"],
};

function registry(
  overrides: Partial<SkillRegistryDocument> = {},
): SkillRegistryDocument {
  return {
    schemaVersion: SKILL_REGISTRY_SCHEMA_VERSION,
    capabilities: [{
      id: "daily-planning",
      purpose: "Select the next bounded unit of work.",
      repositories: ["control", "product"],
    }],
    skills: [
      {
        repository: "control",
        name: "ex-plan-day",
        scope: "repository",
        source: "first-party",
        implements: [{ capability: "daily-planning", repositories: ["control"] }],
      },
      {
        repository: "product",
        name: "ex-plan-day",
        scope: "repository",
        source: "first-party",
        implements: [{ capability: "daily-planning", repositories: ["product"] }],
      },
    ],
    acceptedGaps: [],
    ...overrides,
  };
}

describe("validateSkillRegistry", () => {
  it("unions capability coverage across repository-qualified skills", () => {
    expect(validateSkillRegistry(registry(), options)).toEqual([]);
  });

  it("allows repository-owned skills to share a name", () => {
    const findings = validateSkillRegistry(registry(), options);
    expect(findings.map((finding) => finding.rule)).not.toContain("skill-registry/duplicate-skill");
  });

  it("rejects a duplicate composite identity", () => {
    const current = registry();
    const findings = validateSkillRegistry(registry({
      skills: [...current.skills, current.skills[0]!],
    }), options);
    expect(findings.map((finding) => finding.rule)).toContain("skill-registry/duplicate-skill");
  });

  it("reports a missing capability target", () => {
    const current = registry();
    const findings = validateSkillRegistry(registry({
      skills: [current.skills[0]!],
    }), options);
    expect(findings.map((finding) => finding.rule)).toContain("skill-registry/missing-capability-coverage");
  });

  it("rejects a repository-scoped skill that escapes its owner", () => {
    const findings = validateSkillRegistry(registry({
      skills: [{
        repository: "product",
        name: "ex-plan-day",
        scope: "repository",
        source: "first-party",
        implements: [{ capability: "daily-planning", repositories: ["control", "product"] }],
      }],
    }), options);
    expect(findings.map((finding) => finding.rule)).toContain("skill-registry/repository-scope-escape");
  });

  it("requires a plane-scoped skill to live in the plane repository", () => {
    const findings = validateSkillRegistry(registry({
      skills: [{
        repository: "product",
        name: "ex-plan-day",
        scope: "plane",
        source: "first-party",
        implements: [{ capability: "daily-planning", repositories: ["control", "product"] }],
      }],
    }), options);
    expect(findings.map((finding) => finding.rule)).toContain("skill-registry/plane-skill-outside-plane-repository");
  });

  it("accepts a durable gap for an otherwise missing target", () => {
    const current = registry();
    expect(validateSkillRegistry(registry({
      skills: [current.skills[0]!],
      acceptedGaps: [{
        capability: "daily-planning",
        repositories: ["product"],
        reason: "The local workflow has not earned a reusable skill yet.",
        reference: "documents/skill-registry.md",
      }],
    }), options)).toEqual([]);
  });

  it("rejects an accepted gap without durable evidence", () => {
    const current = registry();
    const findings = validateSkillRegistry(registry({
      skills: [current.skills[0]!],
      acceptedGaps: [{
        capability: "daily-planning",
        repositories: ["product"],
        reason: "Deferred.",
        reference: "later",
      }],
    }), options);
    expect(findings.map((finding) => finding.rule)).toContain("skill-registry/gap-without-durable-reference");
  });

  it("reports an accepted gap once real coverage exists", () => {
    const findings = validateSkillRegistry(registry({
      acceptedGaps: [{
        capability: "daily-planning",
        repositories: ["product"],
        reason: "Deferred before the implementation landed.",
        reference: "https://example.invalid/issues/42",
      }],
    }), options);
    expect(findings.map((finding) => finding.rule)).toContain("skill-registry/stale-accepted-gap");
  });

  it("inventories third-party skills without letting them satisfy coverage", () => {
    const current = registry();
    const findings = validateSkillRegistry(registry({
      skills: [
        current.skills[0]!,
        {
          repository: "product",
          name: "provider-planning-guide",
          scope: "repository",
          source: "third-party",
          implements: [{ capability: "daily-planning", repositories: ["product"] }],
        },
      ],
    }), options);
    expect(findings.map((finding) => finding.rule)).toContain("skill-registry/third-party-implementation");
    expect(findings.map((finding) => finding.rule)).toContain("skill-registry/missing-capability-coverage");
  });

  it("is deterministic and does not mutate frozen input", () => {
    const document = Object.freeze(registry());
    const first = validateSkillRegistry(document, options);
    const second = validateSkillRegistry(document, options);
    expect(second).toEqual(first);
  });
});

describe("validateRoutineSkillCoverage", () => {
  const planeRegistry = registry({
    skills: [{
      repository: "control",
      name: "ex-plan-day",
      scope: "plane",
      source: "first-party",
      implements: [{ capability: "daily-planning", repositories: ["control", "product"] }],
    }],
  });
  const routine: RoutineDeclaration = {
    id: "weekly-plan",
    skill: "ex-plan-day",
    cadence: "weekly",
    scope: ["product"],
    mode: "report-only",
    purpose: "Select the next bounded unit of work.",
  };

  it("accepts routine scope that is a subset of skill coverage", () => {
    expect(validateRoutineSkillCoverage(routine, planeRegistry, options)).toEqual([]);
  });

  it("rejects routine scope outside skill coverage", () => {
    const findings = validateRoutineSkillCoverage(
      { ...routine, scope: ["archive"] },
      planeRegistry,
      options,
    );
    expect(findings.map((finding) => finding.rule)).toContain("routine/scope-outside-skill-coverage");
  });

  it("uses skillRepository to resolve a repository-owned target", () => {
    expect(validateRoutineSkillCoverage(
      { ...routine, skillRepository: "product" },
      registry(),
      options,
    )).toEqual([]);
  });

  it("rejects a routine whose repository-qualified skill does not exist", () => {
    const findings = validateRoutineSkillCoverage(
      { ...routine, skillRepository: "archive" },
      registry(),
      options,
    );
    expect(findings.map((finding) => finding.rule)).toContain("routine/unresolvable-registry-skill");
  });
});
