import type { Finding } from "./types.js";
import type { RepositoryProfile } from "../repository/types.js";

/**
 * Branch provenance: an agent-created branch is attributable from its name.
 * See `conventions/documents/branch-provenance.md`.
 */

/**
 * Prefixes that describe what a change *is* rather than who made it. They are
 * refused not because they are bad names but because they are the wrong axis:
 * a branch can be both a fix and agent-created, and only one of those facts is
 * recoverable from the name later.
 */
export const TAXONOMY_PREFIXES: readonly string[] = Object.freeze([
  "agent",
  "feat",
  "feature",
  "fix",
  "bugfix",
  "hotfix",
  "chore",
  "task",
]);

/** A slug is lowercase kebab case: it must survive being read aloud in a shell. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AGENT_PREFIX = /^[a-z][a-z0-9-]*$/;

/**
 * The exemption a repository actually declared (issue #929).
 *
 * A repository's long-lived branches -- its default branch and, when it has
 * one, its separate release branch -- are exempt from branch provenance
 * because they retain their repository-defined names. Until now the only way
 * to say so was `BranchOptions.exempt`, a list the caller made up at the call
 * site. That list and the repository's real topology could not be
 * cross-checked against each other, because only one of them existed as
 * data: a caller could exempt `release` from a repository that has no release
 * branch, or exempt a branch name with a typo in it, and the check would pass
 * exactly as if the exemption were real.
 *
 * `RepositoryProfileV3.releaseBranch` is the other half, and this function is
 * the join. The set it returns is derived entirely from the profile, so an
 * exemption exists only for a branch the repository declared.
 */
export function branchExemptionsFromProfile(profile: RepositoryProfile): readonly string[] {
  const names: string[] = [profile.defaultBranch];
  // `releaseBranch` exists on v3 only, and a profile of any version can reach
  // this function, so the field is read by presence rather than by assuming
  // the union member. A non-string or empty value contributes no exemption:
  // `validateRepositoryProfile` is where a malformed declaration is reported,
  // and deriving an exemption from one here would be this function silently
  // honoring something that package already refuses.
  const releaseBranch = "releaseBranch" in profile ? profile.releaseBranch : undefined;
  if (typeof releaseBranch === "string" && releaseBranch.length > 0) names.push(releaseBranch);
  return Object.freeze(names);
}

export interface BranchOptions {
  /**
   * Prefixes that identify a creating agent, e.g. `["codex", "claude"]`.
   * This package defines the grammar; which agents exist is a plane's fact.
   */
  readonly agents: readonly string[];
  /**
   * The repository's own declared profile. When supplied, the exemption set
   * derived from it by `branchExemptionsFromProfile` is AUTHORITATIVE: it is
   * the only thing that exempts a branch name, and any entry in `exempt` that
   * the profile does not declare is reported as
   * `branch/undeclared-exemption` rather than honored.
   */
  readonly profile?: RepositoryProfile;
  /**
   * Branch names exempt from the rule -- a repository's default branch and any
   * long-lived release branch. These retain their repository-defined names.
   *
   * @deprecated Supply `profile` instead. This list is retained so that
   * existing callers keep working, but it is no longer the authority: with
   * `profile` supplied it is cross-checked and cannot widen the exemption,
   * and without `profile` it is honored only alongside a
   * `branch/underived-exemption` finding, because a hand-passed list is an
   * exemption nothing can verify against the repository it claims to describe.
   */
  readonly exempt?: readonly string[];
}

/**
 * Validate one branch name. Returns an empty array when the name conforms.
 *
 * The rule applies prospectively: this reports on a name being *created*, and a
 * caller must not use it to justify renaming history. Renaming an existing
 * branch to satisfy a naming rule trades real provenance for cosmetic
 * conformance.
 */
export function validateBranchName(name: string, options: BranchOptions): Finding[] {
  const findings: Finding[] = [];
  const declared = options.profile === undefined ? undefined : branchExemptionsFromProfile(options.profile);
  const supplied = options.exempt ?? [];

  if (typeof name !== "string" || name.trim() === "") {
    return [{ rule: "branch/empty", severity: "high", message: "Branch name is empty." }];
  }

  if (declared !== undefined) {
    for (const candidate of supplied) {
      if (!declared.includes(candidate)) {
        findings.push({
          rule: "branch/undeclared-exemption",
          severity: "high",
          message: `"${candidate}" is exempted but the repository profile does not declare it. Declare it as defaultBranch or releaseBranch, or stop exempting it.`,
        });
      }
    }
  } else if (supplied.length > 0) {
    findings.push({
      rule: "branch/underived-exemption",
      severity: "medium",
      message:
        "An exemption list was supplied without a repository profile, so it cannot be checked against the topology it claims to describe. Supply `profile` and let the exemption be derived from it.",
    });
  }

  // The derived set wins outright when there is one. An entry that appears
  // only in `exempt` has already been reported above and must not also take
  // effect: reporting it and then honoring it anyway would leave the hazard
  // exactly where it was, with a finding next to it.
  const exempt = declared ?? supplied;
  if (exempt.includes(name)) return findings;

  if (options.agents.length === 0) {
    // Accumulated exemption findings are kept rather than discarded: a
    // vacuous check and an unverifiable exemption are two separate defects,
    // and returning only the first would hide the second behind it.
    findings.push({
      rule: "branch/no-agents-declared",
      severity: "high",
      message:
        "No agent prefixes were declared, so provenance cannot be checked. Declare the agents this plane runs rather than letting the check pass vacuously.",
    });
    return findings;
  }
  // Tracked as its own flag rather than read off `findings.length`. The stop
  // below means "the agent declaration is malformed, so judging the name
  // against it would be meaningless" -- it has never meant "some finding
  // exists." Now that an exemption finding can already be in the array by
  // this point, reading the length would let an unrelated exemption defect
  // silently suppress the name check entirely.
  let malformedAgentPrefix = false;
  for (const agent of options.agents) {
    if (!AGENT_PREFIX.test(agent)) {
      malformedAgentPrefix = true;
      findings.push({
        rule: "branch/invalid-agent-prefix",
        severity: "high",
        message: `Declared agent prefix "${agent}" is not a lowercase identifier.`,
      });
    }
  }
  if (malformedAgentPrefix) return findings;

  const separator = name.indexOf("/");
  if (separator === -1) {
    findings.push({
      rule: "branch/missing-provenance",
      severity: "high",
      message: `"${name}" has no provenance segment. Use <agent>/<short-slug>, one of: ${options.agents
        .map((a) => `${a}/`)
        .join(", ")}`,
    });
    return findings;
  }

  const prefix = name.slice(0, separator);
  const slug = name.slice(separator + 1);

  if (!options.agents.includes(prefix)) {
    findings.push({
      rule: TAXONOMY_PREFIXES.includes(prefix) ? "branch/taxonomy-prefix" : "branch/unknown-prefix",
      severity: "high",
      message: TAXONOMY_PREFIXES.includes(prefix)
        ? `"${name}" uses the taxonomy prefix "${prefix}/". Branch taxonomy is not provenance: name the creating agent and put the description in the slug.`
        : `"${name}" starts with "${prefix}/", which is not a declared agent. Declared: ${options.agents.join(", ")}`,
    });
  }

  if (slug === "") {
    findings.push({
      rule: "branch/empty-slug",
      severity: "high",
      message: `"${name}" has an empty slug.`,
    });
  } else if (!SLUG.test(slug)) {
    findings.push({
      rule: "branch/malformed-slug",
      severity: "medium",
      message: `"${slug}" is not lowercase kebab case. Use letters, digits, and single hyphens.`,
    });
  }

  return findings;
}
