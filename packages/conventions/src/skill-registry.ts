import type { Finding } from "./types.js";

/**
 * Capability-first skill registry (v2). See `documents/skill-registry.md`.
 *
 * A routine says *when*; this registry says *what is actually covered*.
 * Keeping the two apart is the entire design: a routine that is disabled,
 * deleted, or never scheduled must never make functional coverage vanish,
 * because coverage was never the routine's fact to hold. Everything here is
 * schema plus deterministic set arithmetic over data a caller supplies --
 * no filesystem, no GitHub, no scheduler, no credential, no network. A
 * registry is a value; a validator is a pure function from that value to
 * `Finding[]`.
 */

/**
 * Bumped only when the shape below changes in a way older data cannot
 * satisfy. A registry that declares a different version is not silently
 * accepted -- see `validateSkillRegistry`'s first check.
 */
export const SKILL_REGISTRY_SCHEMA_VERSION = "2.0.0";

export type SkillScope = "plane" | "repository";

/** One functional requirement, expressed as the set of targets it must reach. */
export interface Capability {
  readonly id: string;
  readonly description: string;
  /** Registry identifiers this capability must cover, most often repositories. */
  readonly requiredTargets: readonly string[];
}

/** One capability a skill claims to implement, and how much of it. */
export interface SkillCapabilityImplementation {
  readonly capability: string;
  /** Subset of that capability's `requiredTargets` this skill actually covers. */
  readonly targets: readonly string[];
}

/**
 * A skill as the registry knows it. Identity is the pair `(repository, name)`
 * for a repository-scoped skill, or `(plane, name)` for a plane-scoped one --
 * never the bare name alone, which is exactly what lets two repositories each
 * own a skill called the same thing without colliding.
 */
export interface RegisteredSkill {
  readonly name: string;
  readonly scope: SkillScope;
  /** Required when `scope` is `"repository"`; must be absent for `"plane"`. */
  readonly repository?: string;
  /**
   * True for a skill this plane installed from outside itself. A third-party
   * skill may still declare `implements`, but it is never counted toward a
   * first-party capability's coverage -- see `validateSkillRegistry`.
   */
  readonly thirdParty?: boolean;
  readonly implements: readonly SkillCapabilityImplementation[];
}

/**
 * A deliberately unfilled part of a capability's required target set. Recording
 * one without a durable reason and a reference is not a quieter version of
 * accepting it -- see `validateSkillRegistry`'s gap checks.
 */
export interface AcceptedGap {
  readonly capability: string;
  readonly target: string;
  /** Why this target is deliberately left open. Must survive the moment it was written. */
  readonly reason: string;
  /** An issue or ADR identifier a later reader can actually open. */
  readonly reference: string;
}

export interface SkillRegistry {
  readonly schemaVersion: string;
  readonly capabilities: readonly Capability[];
  readonly skills: readonly RegisteredSkill[];
  readonly acceptedGaps?: readonly AcceptedGap[];
}

/** What a routine declares about the one skill it targets, for coverage checking only. */
export interface RoutineCoverageQuery {
  readonly skill: string;
  /** Present only when targeting a repository-scoped skill. */
  readonly repository?: string;
  readonly scope: readonly string[];
}

/** The result of deterministic set arithmetic for one capability. */
export interface CapabilityCoverage {
  readonly capability: string;
  readonly required: readonly string[];
  /** Required targets covered by at least one first-party skill. */
  readonly covered: readonly string[];
  /** Required targets excused by a declared accepted gap, valid or not. */
  readonly acceptedGaps: readonly string[];
  /** Required targets neither covered nor excused. */
  readonly missing: readonly string[];
}

function skillIdentity(skill: Pick<RegisteredSkill, "name" | "scope" | "repository">): string {
  return skill.scope === "repository"
    ? `repository:${skill.repository ?? ""}::${skill.name}`
    : `plane::${skill.name}`;
}

/**
 * Union, per capability, of every first-party skill's declared targets.
 * Third-party skills are read here but deliberately excluded from the union --
 * see the module doc comment.
 */
function firstPartyCoverage(registry: SkillRegistry): Map<string, Set<string>> {
  const coverage = new Map<string, Set<string>>();
  for (const skill of registry.skills) {
    if (skill.thirdParty) continue;
    for (const implementation of skill.implements) {
      const targets = coverage.get(implementation.capability) ?? new Set<string>();
      for (const target of implementation.targets) targets.add(target);
      coverage.set(implementation.capability, targets);
    }
  }
  return coverage;
}

/**
 * Deterministic set arithmetic for one capability: required, minus what a
 * first-party skill covers, minus what an accepted gap excuses (regardless of
 * whether that gap is itself well-formed -- pass the registry through
 * `validateSkillRegistry` first to know that). Returns an all-empty shape for
 * an unknown capability id rather than throwing, since "this id does not
 * exist" is itself a fact a caller may want to compute over.
 */
export function computeCapabilityCoverage(
  registry: SkillRegistry,
  capabilityId: string,
): CapabilityCoverage {
  const capability = registry.capabilities.find((entry) => entry.id === capabilityId);
  const required = capability?.requiredTargets ?? [];
  const covered = firstPartyCoverage(registry).get(capabilityId) ?? new Set<string>();
  const gaps = new Set(
    (registry.acceptedGaps ?? [])
      .filter((gap) => gap.capability === capabilityId)
      .map((gap) => gap.target),
  );

  return {
    capability: capabilityId,
    required,
    covered: required.filter((target) => covered.has(target)),
    acceptedGaps: required.filter((target) => !covered.has(target) && gaps.has(target)),
    missing: required.filter((target) => !covered.has(target) && !gaps.has(target)),
  };
}

/**
 * Validate a whole registry. Returns an empty array when it conforms.
 *
 * A malformed accepted gap (missing reason, missing reference, or pointing at
 * a capability or target the registry never declared) is reported for what it
 * is and never treated as excusing the underlying coverage gap -- the target
 * it names still shows up as `registry/missing-capability` alongside it. A
 * gap that cannot be checked or revisited later has not actually accepted
 * anything.
 */
export function validateSkillRegistry(registry: SkillRegistry): Finding[] {
  const findings: Finding[] = [];

  if (registry.schemaVersion !== SKILL_REGISTRY_SCHEMA_VERSION) {
    findings.push({
      rule: "registry/unsupported-schema-version",
      severity: "high",
      message: `Registry declares schema version "${registry.schemaVersion}", but this validator understands "${SKILL_REGISTRY_SCHEMA_VERSION}".`,
    });
  }

  const capabilityIds = new Set<string>();
  for (const capability of registry.capabilities) {
    if (capabilityIds.has(capability.id)) {
      findings.push({
        rule: "registry/duplicate-capability",
        severity: "high",
        message: `Capability "${capability.id}" is declared more than once.`,
      });
    }
    capabilityIds.add(capability.id);
  }

  const seenIdentities = new Set<string>();
  for (const skill of registry.skills) {
    const identity = skillIdentity(skill);
    if (seenIdentities.has(identity)) {
      findings.push({
        rule: "registry/duplicate-skill-identity",
        severity: "high",
        message:
          skill.scope === "repository"
            ? `Skill "${skill.name}" is declared more than once in repository "${skill.repository ?? "(none)"}". Repository-owned skills may share a bare name across repositories; they may not share a full identity.`
            : `Skill "${skill.name}" is declared more than once at plane scope.`,
      });
    }
    seenIdentities.add(identity);

    if (skill.scope === "repository" && (!skill.repository || skill.repository.trim() === "")) {
      findings.push({
        rule: "registry/missing-repository",
        severity: "high",
        message: `Skill "${skill.name}" declares repository scope but names no repository.`,
      });
    }
    if (skill.scope === "plane" && skill.repository) {
      findings.push({
        rule: "registry/scope-repository-mismatch",
        severity: "medium",
        message: `Skill "${skill.name}" declares plane scope but also names repository "${skill.repository}". A plane-scoped skill's coverage is not bounded to one repository.`,
      });
    }

    for (const implementation of skill.implements) {
      if (!capabilityIds.has(implementation.capability)) {
        findings.push({
          rule: "registry/unknown-capability",
          severity: "high",
          message: `Skill "${skill.name}" implements capability "${implementation.capability}", which this registry does not declare.`,
        });
        continue;
      }
      if (skill.scope === "repository" && skill.repository) {
        for (const target of implementation.targets) {
          if (target !== skill.repository) {
            findings.push({
              rule: "registry/scope-escape",
              severity: "high",
              message: `Skill "${skill.name}" is scoped to repository "${skill.repository}" but claims coverage of target "${target}". A repository-scoped skill cannot cover anything outside its own repository.`,
            });
          }
        }
      }
    }
  }

  const seenGaps = new Set<string>();
  const validGapTargets = new Map<string, Set<string>>();
  for (const gap of registry.acceptedGaps ?? []) {
    const key = `${gap.capability}::${gap.target}`;
    if (seenGaps.has(key)) {
      findings.push({
        rule: "registry/duplicate-gap",
        severity: "medium",
        message: `Accepted gap for capability "${gap.capability}" target "${gap.target}" is declared more than once.`,
      });
    }
    seenGaps.add(key);

    let valid = true;
    const capability = registry.capabilities.find((entry) => entry.id === gap.capability);
    if (!capability) {
      findings.push({
        rule: "registry/gap-unknown-capability",
        severity: "high",
        message: `Accepted gap references capability "${gap.capability}", which this registry does not declare.`,
      });
      valid = false;
    } else if (!capability.requiredTargets.includes(gap.target)) {
      findings.push({
        rule: "registry/gap-unknown-target",
        severity: "high",
        message: `Accepted gap for capability "${gap.capability}" names target "${gap.target}", which that capability does not require.`,
      });
      valid = false;
    }
    if (!gap.reason || gap.reason.trim() === "") {
      findings.push({
        rule: "registry/gap-missing-reason",
        severity: "high",
        message: `Accepted gap for capability "${gap.capability}" target "${gap.target}" records no durable reason. An unexplained gap reads as an oversight, not a decision.`,
      });
      valid = false;
    }
    if (!gap.reference || gap.reference.trim() === "") {
      findings.push({
        rule: "registry/gap-missing-reference",
        severity: "high",
        message: `Accepted gap for capability "${gap.capability}" target "${gap.target}" cites no issue or ADR reference. A reason that cannot be revisited later has not actually accepted anything.`,
      });
      valid = false;
    }

    if (valid) {
      const targets = validGapTargets.get(gap.capability) ?? new Set<string>();
      targets.add(gap.target);
      validGapTargets.set(gap.capability, targets);
    }
  }

  const coverage = firstPartyCoverage(registry);
  for (const capability of registry.capabilities) {
    const covered = coverage.get(capability.id) ?? new Set<string>();
    const excused = validGapTargets.get(capability.id) ?? new Set<string>();
    for (const target of capability.requiredTargets) {
      if (covered.has(target) || excused.has(target)) continue;
      findings.push({
        rule: "registry/missing-capability",
        severity: "high",
        message: `Capability "${capability.id}" requires target "${target}", which no first-party skill covers and no accepted gap records.`,
      });
    }
  }

  return findings;
}

/**
 * Validate one routine's target against the registry. This is deliberately
 * the only two checks a routine gets: that the skill it names exists, and
 * that its scope is a subset of what that skill already declares it covers.
 * A routine supplies tempo, never coverage -- it cannot grant a skill
 * coverage the skill never claimed, so there is nothing else here to check.
 */
export function validateRoutineCoverage(
  query: RoutineCoverageQuery,
  registry: SkillRegistry,
): Finding[] {
  const matches = registry.skills.filter(
    (skill) =>
      skill.name === query.skill &&
      (skill.scope === "plane" ? query.repository === undefined : skill.repository === query.repository),
  );

  if (matches.length === 0) {
    return [
      {
        rule: "registry/routine-unresolvable-skill",
        severity: "high",
        message: `Routine targets skill "${query.skill}"${
          query.repository ? ` in repository "${query.repository}"` : ""
        }, which does not resolve in this registry.`,
      },
    ];
  }

  if (matches.length > 1) {
    return [
      {
        rule: "registry/routine-ambiguous-skill",
        severity: "high",
        message: `Routine targets skill "${query.skill}", which resolves to more than one registered identity.`,
      },
    ];
  }

  const skill = matches[0]!;
  const covered = new Set<string>();
  for (const implementation of skill.implements) {
    for (const target of implementation.targets) covered.add(target);
  }

  const findings: Finding[] = [];
  for (const target of query.scope) {
    if (!covered.has(target)) {
      findings.push({
        rule: "registry/routine-scope-exceeds-coverage",
        severity: "high",
        message: `Routine scopes "${target}", which skill "${query.skill}" does not declare coverage for. A routine can only draw tempo from coverage the registry already declares; it cannot grant new coverage.`,
      });
    }
  }
  return findings;
}
