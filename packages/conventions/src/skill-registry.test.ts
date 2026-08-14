import { describe, expect, it } from "vitest";
import {
  SKILL_REGISTRY_SCHEMA_VERSION,
  computeCapabilityCoverage,
  validateRoutineCoverage,
  validateSkillRegistry,
} from "./skill-registry.js";
import type { SkillRegistry } from "./skill-registry.js";

const baseCapability = {
  id: "dependency-freshness-review",
  description: "Repositories reviewed for dependency drift on a recurring basis.",
  requiredTargets: ["repo-a", "repo-b", "repo-c"],
};

function registry(overrides: Partial<SkillRegistry> = {}): SkillRegistry {
  return {
    schemaVersion: SKILL_REGISTRY_SCHEMA_VERSION,
    capabilities: [baseCapability],
    skills: [],
    ...overrides,
  };
}

describe("validateSkillRegistry / schema version", () => {
  it("rejects a registry declaring a version this validator does not understand", () => {
    const findings = validateSkillRegistry(registry({ schemaVersion: "1.0.0" }));
    expect(findings.map((f) => f.rule)).toContain("registry/unsupported-schema-version");
  });
});

describe("validateSkillRegistry / coverage union", () => {
  it("passes when two first-party skills' targets union to full coverage", () => {
    const reg = registry({
      skills: [
        {
          name: "review-dependency-freshness",
          scope: "repository",
          repository: "repo-a",
          implements: [{ capability: "dependency-freshness-review", targets: ["repo-a"] }],
        },
        {
          name: "review-dependency-freshness",
          scope: "repository",
          repository: "repo-b",
          implements: [{ capability: "dependency-freshness-review", targets: ["repo-b"] }],
        },
        {
          name: "review-dependency-freshness",
          scope: "repository",
          repository: "repo-c",
          implements: [{ capability: "dependency-freshness-review", targets: ["repo-c"] }],
        },
      ],
    });

    expect(validateSkillRegistry(reg)).toEqual([]);
    expect(computeCapabilityCoverage(reg, "dependency-freshness-review").missing).toEqual([]);
  });

  it("reports what a partial union still leaves missing", () => {
    const reg = registry({
      skills: [
        {
          name: "review-dependency-freshness",
          scope: "repository",
          repository: "repo-a",
          implements: [{ capability: "dependency-freshness-review", targets: ["repo-a"] }],
        },
      ],
    });

    const coverage = computeCapabilityCoverage(reg, "dependency-freshness-review");
    expect(coverage.covered).toEqual(["repo-a"]);
    expect(coverage.missing).toEqual(["repo-b", "repo-c"]);
  });
});

describe("validateSkillRegistry / duplicate composite identity", () => {
  it("does not flag two repository-owned skills sharing a bare name", () => {
    const reg = registry({
      skills: [
        {
          name: "review-dependency-freshness",
          scope: "repository",
          repository: "repo-a",
          implements: [{ capability: "dependency-freshness-review", targets: ["repo-a"] }],
        },
        {
          name: "review-dependency-freshness",
          scope: "repository",
          repository: "repo-b",
          implements: [{ capability: "dependency-freshness-review", targets: ["repo-b"] }],
        },
      ],
    });
    expect(validateSkillRegistry(reg).map((f) => f.rule)).not.toContain(
      "registry/duplicate-skill-identity",
    );
  });

  it("flags the same skill declared twice at the same repository", () => {
    const reg = registry({
      skills: [
        {
          name: "review-dependency-freshness",
          scope: "repository",
          repository: "repo-a",
          implements: [{ capability: "dependency-freshness-review", targets: ["repo-a"] }],
        },
        {
          name: "review-dependency-freshness",
          scope: "repository",
          repository: "repo-a",
          implements: [{ capability: "dependency-freshness-review", targets: ["repo-a"] }],
        },
      ],
    });
    expect(validateSkillRegistry(reg).map((f) => f.rule)).toContain(
      "registry/duplicate-skill-identity",
    );
  });

  it("flags the same plane-scoped skill declared twice", () => {
    const reg = registry({
      skills: [
        { name: "plan-registry-adoption", scope: "plane", implements: [] },
        { name: "plan-registry-adoption", scope: "plane", implements: [] },
      ],
    });
    expect(validateSkillRegistry(reg).map((f) => f.rule)).toContain(
      "registry/duplicate-skill-identity",
    );
  });
});

describe("validateSkillRegistry / scope escape", () => {
  it("flags a repository-scoped skill claiming coverage outside its own repository", () => {
    const reg = registry({
      skills: [
        {
          name: "review-dependency-freshness",
          scope: "repository",
          repository: "repo-a",
          implements: [
            { capability: "dependency-freshness-review", targets: ["repo-a", "repo-b"] },
          ],
        },
      ],
    });
    expect(validateSkillRegistry(reg).map((f) => f.rule)).toContain("registry/scope-escape");
  });

  it("requires a repository when scope is repository", () => {
    const reg = registry({
      skills: [{ name: "review-dependency-freshness", scope: "repository", implements: [] }],
    });
    expect(validateSkillRegistry(reg).map((f) => f.rule)).toContain(
      "registry/missing-repository",
    );
  });

  it("allows a plane-scoped skill to cover more than one repository", () => {
    const reg = registry({
      skills: [
        {
          name: "review-dependency-freshness",
          scope: "plane",
          implements: [
            {
              capability: "dependency-freshness-review",
              targets: ["repo-a", "repo-b", "repo-c"],
            },
          ],
        },
      ],
    });
    expect(validateSkillRegistry(reg)).toEqual([]);
  });
});

describe("validateSkillRegistry / missing capability", () => {
  it("flags a capability with no declaring skill at all", () => {
    const findings = validateSkillRegistry(registry());
    expect(findings.map((f) => f.rule)).toEqual([
      "registry/missing-capability",
      "registry/missing-capability",
      "registry/missing-capability",
    ]);
  });

  it("flags a skill implementing a capability the registry never declared", () => {
    const reg = registry({
      skills: [
        {
          name: "review-dependency-freshness",
          scope: "repository",
          repository: "repo-a",
          implements: [{ capability: "no-such-capability", targets: ["repo-a"] }],
        },
      ],
    });
    expect(validateSkillRegistry(reg).map((f) => f.rule)).toContain(
      "registry/unknown-capability",
    );
  });
});

describe("validateSkillRegistry / third-party skills", () => {
  it("never lets a third-party skill silently satisfy a first-party requirement", () => {
    const reg = registry({
      skills: [
        {
          name: "vendor-dependency-review",
          scope: "plane",
          thirdParty: true,
          implements: [
            {
              capability: "dependency-freshness-review",
              targets: ["repo-a", "repo-b", "repo-c"],
            },
          ],
        },
      ],
    });
    const findings = validateSkillRegistry(reg);
    expect(findings.filter((f) => f.rule === "registry/missing-capability")).toHaveLength(3);
  });
});

describe("validateSkillRegistry / accepted gap", () => {
  it("accepts a well-formed gap and clears the underlying missing-capability finding", () => {
    const reg = registry({
      skills: [
        {
          name: "review-dependency-freshness",
          scope: "repository",
          repository: "repo-a",
          implements: [{ capability: "dependency-freshness-review", targets: ["repo-a"] }],
        },
        {
          name: "review-dependency-freshness",
          scope: "repository",
          repository: "repo-b",
          implements: [{ capability: "dependency-freshness-review", targets: ["repo-b"] }],
        },
      ],
      acceptedGaps: [
        {
          capability: "dependency-freshness-review",
          target: "repo-c",
          reason: "repo-c is archived and receives no further dependency work.",
          reference: "foundry#900",
        },
      ],
    });
    expect(validateSkillRegistry(reg)).toEqual([]);
  });

  it("flags a gap missing its reason, and still reports the coverage as missing", () => {
    const reg = registry({
      acceptedGaps: [
        { capability: "dependency-freshness-review", target: "repo-c", reason: "", reference: "foundry#900" },
      ],
    });
    const findings = validateSkillRegistry(reg);
    expect(findings.map((f) => f.rule)).toContain("registry/gap-missing-reason");
    expect(
      findings.filter(
        (f) => f.rule === "registry/missing-capability" && f.message.includes("repo-c"),
      ),
    ).toHaveLength(1);
  });

  it("flags a gap missing its reference", () => {
    const reg = registry({
      acceptedGaps: [
        {
          capability: "dependency-freshness-review",
          target: "repo-c",
          reason: "repo-c is archived.",
          reference: "",
        },
      ],
    });
    expect(validateSkillRegistry(reg).map((f) => f.rule)).toContain(
      "registry/gap-missing-reference",
    );
  });

  it("flags a gap with neither a reason nor a reference, rather than passing it silently", () => {
    const reg = registry({
      acceptedGaps: [
        { capability: "dependency-freshness-review", target: "repo-c", reason: "", reference: "" },
      ],
    });
    const findings = validateSkillRegistry(reg).map((f) => f.rule);
    expect(findings).toContain("registry/gap-missing-reason");
    expect(findings).toContain("registry/gap-missing-reference");
  });

  it("flags a gap pointing at a target its capability never required", () => {
    const reg = registry({
      acceptedGaps: [
        {
          capability: "dependency-freshness-review",
          target: "repo-z",
          reason: "Never required.",
          reference: "foundry#900",
        },
      ],
    });
    expect(validateSkillRegistry(reg).map((f) => f.rule)).toContain(
      "registry/gap-unknown-target",
    );
  });

  it("flags a gap pointing at an undeclared capability", () => {
    const reg = registry({
      acceptedGaps: [
        {
          capability: "no-such-capability",
          target: "repo-a",
          reason: "Never required.",
          reference: "foundry#900",
        },
      ],
    });
    expect(validateSkillRegistry(reg).map((f) => f.rule)).toContain(
      "registry/gap-unknown-capability",
    );
  });
});

describe("validateRoutineCoverage / routine-subset validation", () => {
  const reg = registry({
    skills: [
      {
        name: "review-dependency-freshness",
        scope: "repository",
        repository: "repo-a",
        implements: [{ capability: "dependency-freshness-review", targets: ["repo-a"] }],
      },
    ],
  });

  it("passes when the routine's scope is a subset of the skill's declared coverage", () => {
    expect(
      validateRoutineCoverage(
        { skill: "review-dependency-freshness", repository: "repo-a", scope: ["repo-a"] },
        reg,
      ),
    ).toEqual([]);
  });

  it("rejects a target skill that does not resolve", () => {
    const findings = validateRoutineCoverage(
      { skill: "no-such-skill", scope: ["repo-a"] },
      reg,
    );
    expect(findings.map((f) => f.rule)).toContain("registry/routine-unresolvable-skill");
  });

  it("rejects a routine scope reaching beyond the skill's declared coverage", () => {
    const findings = validateRoutineCoverage(
      { skill: "review-dependency-freshness", repository: "repo-a", scope: ["repo-a", "repo-b"] },
      reg,
    );
    expect(findings.map((f) => f.rule)).toContain("registry/routine-scope-exceeds-coverage");
  });

  it("never grants coverage a skill did not declare, even for an empty routine scope", () => {
    expect(
      validateRoutineCoverage(
        { skill: "review-dependency-freshness", repository: "repo-a", scope: [] },
        reg,
      ),
    ).toEqual([]);
  });
});
