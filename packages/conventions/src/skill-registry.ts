import type { RoutineDeclaration } from "./types.js";
import type { Finding } from "./types.js";
import { validateSkillName } from "./skills.js";

/**
 * Capability-first skill registry schema. The schema holds no cadence: a
 * routine can add tempo to declared coverage, but it cannot create coverage.
 */
export const SKILL_REGISTRY_SCHEMA_VERSION = 2 as const;

export type SkillRegistryScope = "plane" | "repository";
export type SkillRegistrySource = "first-party" | "third-party";

export interface SkillRegistryCapability {
  readonly id: string;
  readonly purpose: string;
  /** Repository identifiers that require this capability. */
  readonly repositories: readonly string[];
}

export interface SkillRegistryImplementation {
  readonly capability: string;
  /** The part of the capability's required set this skill implements. */
  readonly repositories: readonly string[];
}

export interface SkillRegistryEntry {
  /** Repository that owns the skill source. */
  readonly repository: string;
  readonly name: string;
  readonly scope: SkillRegistryScope;
  readonly source: SkillRegistrySource;
  /** Third-party entries are inventory only and may not implement coverage. */
  readonly implements?: readonly SkillRegistryImplementation[];
}

export interface SkillRegistryAcceptedGap {
  readonly capability: string;
  readonly repositories: readonly string[];
  readonly reason: string;
  /** An issue URL or repository-relative decision/ADR path. */
  readonly reference: string;
}

export interface SkillRegistryDocument {
  readonly schemaVersion: typeof SKILL_REGISTRY_SCHEMA_VERSION;
  readonly capabilities: readonly SkillRegistryCapability[];
  readonly skills: readonly SkillRegistryEntry[];
  readonly acceptedGaps?: readonly SkillRegistryAcceptedGap[];
}

export interface SkillRegistryOptions {
  /** Repository identifiers governed by the declaring plane. */
  readonly repositories: readonly string[];
  /** Repository that owns workflows spanning more than one repository. */
  readonly planeRepository: string;
  /** First-party owner prefixes supplied by the plane. */
  readonly prefixes: readonly string[];
  readonly reservedNamespaces?: readonly string[];
}

const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HTTPS_REFERENCE = /^https:\/\/[^\s]+$/;
const RELATIVE_REFERENCE = /^(?![./])(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+(?:#[A-Za-z0-9._-]+)?$/;

function pair(left: string, right: string): string {
  return `${left}\u0000${right}`;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate];
}

function durableReference(reference: string): boolean {
  return HTTPS_REFERENCE.test(reference) || RELATIVE_REFERENCE.test(reference);
}

/**
 * Validate one plane-owned registry using only caller-supplied values. This is
 * deliberately pure: it does not discover repositories, read a tree, or ask a
 * scheduler whether anything is installed.
 */
export function validateSkillRegistry(
  document: SkillRegistryDocument,
  options: SkillRegistryOptions,
): Finding[] {
  const findings: Finding[] = [];
  const governedRepositories = new Set(options.repositories);

  if (document.schemaVersion !== SKILL_REGISTRY_SCHEMA_VERSION) {
    findings.push({
      rule: "skill-registry/schema-version",
      severity: "high",
      message: `Skill registry schemaVersion must be ${SKILL_REGISTRY_SCHEMA_VERSION}.`,
    });
  }

  if (!governedRepositories.has(options.planeRepository)) {
    findings.push({
      rule: "skill-registry/unknown-plane-repository",
      severity: "high",
      message: `Plane repository "${options.planeRepository}" is not in the governed repository set.`,
    });
  }

  const capabilities = new Map<string, SkillRegistryCapability>();
  for (const capability of document.capabilities) {
    if (!IDENTIFIER.test(capability.id)) {
      findings.push({
        rule: "skill-registry/malformed-capability",
        severity: "high",
        message: `Capability id "${capability.id}" must be lowercase kebab case.`,
      });
    }
    if (capabilities.has(capability.id)) {
      findings.push({
        rule: "skill-registry/duplicate-capability",
        severity: "high",
        message: `Capability "${capability.id}" is declared more than once.`,
      });
    }
    capabilities.set(capability.id, capability);
    if (!capability.purpose?.trim()) {
      findings.push({
        rule: "skill-registry/capability-without-purpose",
        severity: "high",
        message: `Capability "${capability.id}" has no purpose.`,
      });
    }
    if (capability.repositories.length === 0) {
      findings.push({
        rule: "skill-registry/capability-without-targets",
        severity: "high",
        message: `Capability "${capability.id}" has an empty required target set.`,
      });
    }
    for (const repository of duplicates(capability.repositories)) {
      findings.push({
        rule: "skill-registry/duplicate-capability-target",
        severity: "high",
        message: `Capability "${capability.id}" repeats repository "${repository}" in its required target set.`,
      });
    }
    for (const repository of capability.repositories) {
      if (!governedRepositories.has(repository)) {
        findings.push({
          rule: "skill-registry/capability-outside-plane",
          severity: "high",
          message: `Capability "${capability.id}" requires "${repository}", which the plane does not govern.`,
        });
      }
    }
  }

  const skillIdentities = new Set<string>();
  const coverage = new Map<string, Set<string>>();
  for (const skill of document.skills) {
    const identity = pair(skill.repository, skill.name);
    if (skillIdentities.has(identity)) {
      findings.push({
        rule: "skill-registry/duplicate-skill",
        severity: "high",
        message: `Skill (${skill.repository}, ${skill.name}) is declared more than once.`,
      });
    }
    skillIdentities.add(identity);

    if (!governedRepositories.has(skill.repository)) {
      findings.push({
        rule: "skill-registry/skill-outside-plane",
        severity: "high",
        message: `Skill "${skill.name}" is owned by undeclared repository "${skill.repository}".`,
      });
    }
    if (skill.scope !== "plane" && skill.scope !== "repository") {
      findings.push({
        rule: "skill-registry/unknown-scope",
        severity: "high",
        message: `Skill "${skill.name}" has unknown scope "${String(skill.scope)}".`,
      });
    }
    if (skill.scope === "plane" && skill.repository !== options.planeRepository) {
      findings.push({
        rule: "skill-registry/plane-skill-outside-plane-repository",
        severity: "high",
        message: `Plane-scoped skill "${skill.name}" must live in "${options.planeRepository}", not "${skill.repository}".`,
      });
    }
    if (skill.source !== "first-party" && skill.source !== "third-party") {
      findings.push({
        rule: "skill-registry/unknown-source",
        severity: "high",
        message: `Skill "${skill.name}" has unknown source "${String(skill.source)}".`,
      });
    }

    if (skill.source === "first-party") {
      findings.push(...validateSkillName(skill.name, {
        prefixes: options.prefixes,
        reservedNamespaces: options.reservedNamespaces,
      }));
    } else if (skill.source === "third-party" && (skill.implements?.length ?? 0) > 0) {
      findings.push({
        rule: "skill-registry/third-party-implementation",
        severity: "high",
        message: `Third-party skill "${skill.name}" is inventory only and cannot silently satisfy a first-party capability.`,
      });
    }

    for (const implementation of skill.implements ?? []) {
      const capability = capabilities.get(implementation.capability);
      if (!capability) {
        findings.push({
          rule: "skill-registry/unknown-capability",
          severity: "high",
          message: `Skill "${skill.name}" implements undeclared capability "${implementation.capability}".`,
        });
      }
      if (implementation.repositories.length === 0) {
        findings.push({
          rule: "skill-registry/implementation-without-targets",
          severity: "high",
          message: `Skill "${skill.name}" declares empty coverage for "${implementation.capability}".`,
        });
      }
      for (const repository of duplicates(implementation.repositories)) {
        findings.push({
          rule: "skill-registry/duplicate-implementation-target",
          severity: "high",
          message: `Skill "${skill.name}" repeats "${repository}" in its coverage for "${implementation.capability}".`,
        });
      }
      for (const repository of implementation.repositories) {
        if (!governedRepositories.has(repository)) {
          findings.push({
            rule: "skill-registry/coverage-outside-plane",
            severity: "high",
            message: `Skill "${skill.name}" claims coverage for "${repository}", which the plane does not govern.`,
          });
        }
        if (skill.scope === "repository" && repository !== skill.repository) {
          findings.push({
            rule: "skill-registry/repository-scope-escape",
            severity: "high",
            message: `Repository-scoped skill "${skill.name}" in "${skill.repository}" cannot cover "${repository}".`,
          });
        }
        if (capability && !capability.repositories.includes(repository)) {
          findings.push({
            rule: "skill-registry/coverage-outside-capability",
            severity: "high",
            message: `Skill "${skill.name}" covers "${repository}" for "${implementation.capability}", but that repository does not require the capability.`,
          });
        }
        if (skill.source === "first-party" && capability) {
          const covered = coverage.get(implementation.capability) ?? new Set<string>();
          covered.add(repository);
          coverage.set(implementation.capability, covered);
        }
      }
    }
  }

  const gaps = new Map<string, Set<string>>();
  const gapPairs = new Set<string>();
  for (const gap of document.acceptedGaps ?? []) {
    const capability = capabilities.get(gap.capability);
    if (!capability) {
      findings.push({
        rule: "skill-registry/unknown-gap-capability",
        severity: "high",
        message: `Accepted gap names undeclared capability "${gap.capability}".`,
      });
    }
    if (!gap.reason?.trim()) {
      findings.push({
        rule: "skill-registry/gap-without-reason",
        severity: "high",
        message: `Accepted gap for "${gap.capability}" has no reason.`,
      });
    }
    if (!durableReference(gap.reference ?? "")) {
      findings.push({
        rule: "skill-registry/gap-without-durable-reference",
        severity: "high",
        message: `Accepted gap for "${gap.capability}" must cite an HTTPS issue URL or repository-relative decision/ADR path.`,
      });
    }
    if (gap.repositories.length === 0) {
      findings.push({
        rule: "skill-registry/gap-without-targets",
        severity: "high",
        message: `Accepted gap for "${gap.capability}" has an empty target set.`,
      });
    }
    for (const repository of gap.repositories) {
      const gapIdentity = pair(gap.capability, repository);
      if (gapPairs.has(gapIdentity)) {
        findings.push({
          rule: "skill-registry/duplicate-gap",
          severity: "high",
          message: `Accepted gap for "${gap.capability}" at "${repository}" is declared more than once.`,
        });
      }
      gapPairs.add(gapIdentity);
      if (!governedRepositories.has(repository)) {
        findings.push({
          rule: "skill-registry/gap-outside-plane",
          severity: "high",
          message: `Accepted gap for "${gap.capability}" names undeclared repository "${repository}".`,
        });
      }
      if (capability && !capability.repositories.includes(repository)) {
        findings.push({
          rule: "skill-registry/gap-outside-capability",
          severity: "high",
          message: `Accepted gap for "${gap.capability}" names "${repository}", which does not require that capability.`,
        });
      }
      if (capability) {
        const accepted = gaps.get(gap.capability) ?? new Set<string>();
        accepted.add(repository);
        gaps.set(gap.capability, accepted);
      }
    }
  }

  for (const capability of document.capabilities) {
    const covered = coverage.get(capability.id) ?? new Set<string>();
    const accepted = gaps.get(capability.id) ?? new Set<string>();
    for (const repository of capability.repositories) {
      if (covered.has(repository) && accepted.has(repository)) {
        findings.push({
          rule: "skill-registry/stale-accepted-gap",
          severity: "medium",
          message: `Capability "${capability.id}" is covered for "${repository}" but still records an accepted gap.`,
        });
      } else if (!covered.has(repository) && !accepted.has(repository)) {
        findings.push({
          rule: "skill-registry/missing-capability-coverage",
          severity: "high",
          message: `Capability "${capability.id}" has no implementation or accepted gap for "${repository}".`,
        });
      }
    }
  }

  return findings;
}

/**
 * Validate only the relationship a routine is allowed to add: its target
 * skill must exist, and its scope must be a subset of that skill's declared
 * first-party coverage. Cadence and live scheduler state are intentionally
 * outside this function.
 */
export function validateRoutineSkillCoverage(
  declaration: RoutineDeclaration,
  document: SkillRegistryDocument,
  options: SkillRegistryOptions,
): Finding[] {
  const repository = declaration.skillRepository ?? options.planeRepository;
  const skill = document.skills.find(
    (entry) => entry.repository === repository && entry.name === declaration.skill,
  );
  if (!skill || skill.source !== "first-party") {
    return [{
      rule: "routine/unresolvable-registry-skill",
      severity: "high",
      message: `Routine "${declaration.id}" targets first-party skill (${repository}, ${declaration.skill}), which is not declared in the skill registry.`,
    }];
  }

  const capabilityTargets = new Map(
    document.capabilities.map((capability) => [capability.id, new Set(capability.repositories)]),
  );
  const covered = new Set(
    (skill.implements ?? []).flatMap((implementation) => {
      const required = capabilityTargets.get(implementation.capability);
      return required
        ? implementation.repositories.filter(
          (target) => required.has(target) && options.repositories.includes(target),
        )
        : [];
    }),
  );
  const findings: Finding[] = [];
  for (const target of declaration.scope) {
    if (!covered.has(target)) {
      findings.push({
        rule: "routine/scope-outside-skill-coverage",
        severity: "high",
        message: `Routine "${declaration.id}" scopes "${target}", which skill (${repository}, ${declaration.skill}) does not cover.`,
      });
    }
  }
  return findings;
}
