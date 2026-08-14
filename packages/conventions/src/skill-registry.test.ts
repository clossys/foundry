import { describe, expect, it } from "vitest";
import {
  SKILL_REGISTRY_SCHEMA_VERSION,
  validateRoutineSkillCoverage,
  validateSkillRegistry,
} from "./skill-registry.js";
import { validateRoutineDeclaration } from "./routines.js";
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
        reference: "https://example.invalid/project/issues/42",
      }],
    }), options)).toEqual([]);
  });

  it("accepts a repository-relative ADR filename", () => {
    const current = registry();
    expect(validateSkillRegistry(registry({
      skills: [current.skills[0]!],
      acceptedGaps: [{
        capability: "daily-planning",
        repositories: ["product"],
        reason: "The local workflow has not earned a reusable skill yet.",
        reference: ["documents", "ADR-0042-planning-gap.md"].join("/"),
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

  it.each([
    "https://example.com",
    "documents/skill-registry.md",
    "src/ADR-0042.ts",
  ])("does not let a non-issue or non-decision reference suppress missing coverage: %s", (reference) => {
    const current = registry();
    const findings = validateSkillRegistry(registry({
      skills: [current.skills[0]!],
      acceptedGaps: [{
        capability: "daily-planning",
        repositories: ["product"],
        reason: "Deferred.",
        reference,
      }],
    }), options);
    expect(findings.map((finding) => finding.rule)).toContain("skill-registry/gap-without-durable-reference");
    expect(findings.map((finding) => finding.rule)).toContain("skill-registry/missing-capability-coverage");
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

  it("returns deterministic findings for missing required document arrays", () => {
    const malformed = { schemaVersion: SKILL_REGISTRY_SCHEMA_VERSION };
    const first = validateSkillRegistry(malformed, options);
    const second = validateSkillRegistry(malformed, options);
    expect(second).toEqual(first);
    expect(first.map((finding) => finding.rule)).toEqual([
      "skill-registry/malformed-capabilities",
      "skill-registry/malformed-skills",
    ]);
  });

  it("returns findings instead of throwing for malformed document entries", () => {
    const findings = validateSkillRegistry({
      schemaVersion: SKILL_REGISTRY_SCHEMA_VERSION,
      capabilities: [null, { id: "daily-planning", purpose: "Plan.", repositories: "product" }],
      skills: [42, {
        repository: "control",
        name: "ex-plan-day",
        scope: "plane",
        source: "first-party",
        implements: [null],
      }],
      acceptedGaps: [false],
    }, options);
    expect(findings.map((finding) => finding.rule)).toEqual([
      "skill-registry/malformed-capability-entry",
      "skill-registry/malformed-capability-entry",
      "skill-registry/malformed-skill-entry",
      "skill-registry/malformed-implementation-entry",
      "skill-registry/malformed-accepted-gap-entry",
    ]);
  });

  it("returns deterministic findings for malformed options", () => {
    const malformedOptions = {
      repositories: "control",
      planeRepository: 7,
      prefixes: ["ex", 7],
      reservedNamespaces: "provider",
    };
    const first = validateSkillRegistry(registry(), malformedOptions);
    const second = validateSkillRegistry(registry(), malformedOptions);
    expect(second).toEqual(first);
    expect(first.map((finding) => finding.rule)).toEqual([
      "skill-registry/malformed-option-repositories",
      "skill-registry/malformed-option-plane-repository",
      "skill-registry/malformed-option-prefixes",
      "skill-registry/malformed-option-reserved-namespaces",
    ]);
  });

  it("returns a finding for a non-object document", () => {
    expect(validateSkillRegistry(null, options).map((finding) => finding.rule)).toEqual([
      "skill-registry/malformed-document",
    ]);
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
    const repositoryRoutine = { ...routine, skillRepository: "product" };
    const ordinaryFindings = validateRoutineDeclaration(repositoryRoutine, {
      repositories: options.repositories,
      skills: ["ex-plan-day"],
      cadences: ["weekly"],
      modes: ["report-only"],
    });
    const coverageFindings = validateRoutineSkillCoverage(
      repositoryRoutine,
      registry(),
      options,
    );
    expect([...ordinaryFindings, ...coverageFindings]).toEqual([]);
  });

  it("rejects a routine whose repository-qualified skill does not exist", () => {
    const findings = validateRoutineSkillCoverage(
      { ...routine, skillRepository: "archive" },
      registry(),
      options,
    );
    expect(findings.map((finding) => finding.rule)).toContain("routine/unresolvable-registry-skill");
  });

  it("returns findings instead of throwing for malformed routine coverage input", () => {
    expect(validateRoutineSkillCoverage(
      { id: "weekly-plan", skill: "ex-plan-day", scope: "product" },
      { schemaVersion: SKILL_REGISTRY_SCHEMA_VERSION },
      { repositories: null, planeRepository: "control", prefixes: ["ex"] },
    ).map((finding) => finding.rule)).toEqual([
      "skill-registry/malformed-capabilities",
      "skill-registry/malformed-skills",
      "skill-registry/malformed-option-repositories",
      "routine/malformed-skill-coverage-declaration",
    ]);
  });
});
