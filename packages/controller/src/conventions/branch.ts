import type { Finding } from "./types.js";

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

export interface BranchOptions {
  /**
   * Prefixes that identify a creating agent, e.g. `["codex", "claude"]`.
   * This package defines the grammar; which agents exist is a plane's fact.
   */
  readonly agents: readonly string[];
  /**
   * Branch names exempt from the rule -- a repository's default branch and any
   * long-lived release branch. These retain their repository-defined names.
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
  const exempt = options.exempt ?? [];

  if (typeof name !== "string" || name.trim() === "") {
    return [{ rule: "branch/empty", severity: "high", message: "Branch name is empty." }];
  }
  if (exempt.includes(name)) return findings;

  if (options.agents.length === 0) {
    return [
      {
        rule: "branch/no-agents-declared",
        severity: "high",
        message:
          "No agent prefixes were declared, so provenance cannot be checked. Declare the agents this plane runs rather than letting the check pass vacuously.",
      },
    ];
  }
  for (const agent of options.agents) {
    if (!AGENT_PREFIX.test(agent)) {
      findings.push({
        rule: "branch/invalid-agent-prefix",
        severity: "high",
        message: `Declared agent prefix "${agent}" is not a lowercase identifier.`,
      });
    }
  }
  if (findings.length > 0) return findings;

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
