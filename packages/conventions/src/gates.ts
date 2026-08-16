import type { Finding } from "./types.js";

/**
 * CI gate naming: the required-status-check context names a repository
 * publishes. See `documents/gate-naming.md`.
 *
 * A gate context lives inside exactly one repository, which belongs to
 * exactly one account. There is no namespace to disambiguate, so -- unlike
 * `validateSkillName`, whose prefix is legitimate because every account
 * installs into one shared skills tree -- a gate name carries no account or
 * repository prefix, and this module offers no `prefixes`-shaped option for
 * one. A per-account prefix would also give every account's ruleset a
 * different shape, defeating the one thing a shared naming grammar buys:
 * being able to compare gate names across repositories at all.
 */

/** A gate name is a single lowercase-kebab token: verb first, at least one noun after it. */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A small, extensible verb vocabulary offered as a default, not closed the
 * way `SKILL_VERBS` is. `validateGateName` accepts `options.verbs` so a
 * repository with a genuinely new gate verb this list doesn't yet know can
 * extend it without waiting on a release of this package -- gate verbs are
 * read off ordinary English usage, not off which account is asking, so
 * closing the list the way a prefix or a registry is closed would only add
 * friction with nothing to protect.
 */
export const GATE_VERBS: readonly string[] = Object.freeze([
  "audit",
  "block",
  "build",
  "check",
  "compile",
  "deploy",
  "detect",
  "enforce",
  "format",
  "generate",
  "guard",
  "lint",
  "publish",
  "require",
  "scan",
  "sync",
  "test",
  "typecheck",
  "validate",
  "verify",
]);

/**
 * Small clusters of nouns that name the same idea in different words.
 * Deliberately incomplete -- completeness is not the goal. It exists to
 * catch the specific, recurring mistake of adding a third segment that
 * restates the second instead of narrowing it (`scan-secrets-leaks`, where
 * "leaks" adds nothing "secrets" didn't already say), and to leave a
 * genuinely disambiguating third segment alone (`verify-review-evidence`,
 * where "evidence" narrows "review" rather than repeating it).
 */
const NOUN_SYNONYM_CLUSTERS: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(["secret", "secrets", "leak", "leaks"]),
  Object.freeze(["repo", "repos", "repository", "repositories"]),
  Object.freeze(["doc", "docs", "document", "documents"]),
]);

function sameNounCluster(a: string, b: string): boolean {
  if (a === b) return true;
  return NOUN_SYNONYM_CLUSTERS.some((cluster) => cluster.includes(a) && cluster.includes(b));
}

export interface GateNameOptions {
  /**
   * Verbs recognized as valid actions for a gate name's first segment.
   * Defaults to `GATE_VERBS`. Unlike `BranchOptions.agents` or
   * `SkillOptions.prefixes`, this is not a fact the caller must supply --
   * gate verbs are the same everywhere English is -- so it exists only as an
   * escape hatch for a repository with a real verb this default vocabulary
   * doesn't yet know.
   */
  readonly verbs?: readonly string[];
}

/**
 * Validate one gate name. Returns an empty array when it conforms.
 *
 * The grammar is verb-noun, extended to verb-noun-noun only where the extra
 * segment disambiguates a specific check within a broader family. It is not
 * a fixed slot grammar -- there is no maximum segment count -- but a segment
 * that only restates an earlier one is reported rather than encouraged.
 */
export function validateGateName(name: string, options: GateNameOptions = {}): Finding[] {
  const findings: Finding[] = [];

  if (typeof name !== "string" || name.trim() === "") {
    return [{ rule: "gate/empty", severity: "high", message: "Gate name is empty." }];
  }

  if (/[A-Z]/.test(name)) {
    findings.push({
      rule: "gate/uppercase",
      severity: "high",
      message: `"${name}" contains an uppercase letter. A gate name is lowercase.`,
    });
  }
  if (/\s/.test(name)) {
    findings.push({
      rule: "gate/whitespace",
      severity: "high",
      message: `"${name}" contains whitespace. A gate name is a single token, not a sentence.`,
    });
  }
  if (name.includes(",")) {
    findings.push({
      rule: "gate/comma",
      severity: "high",
      message: `"${name}" contains a comma. A gate name identifies one check, not a list of steps.`,
    });
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    findings.push({
      rule: "gate/edge-hyphen",
      severity: "high",
      message: `"${name}" starts or ends with a hyphen, which produces an empty segment.`,
    });
  }
  if (name.includes("--")) {
    findings.push({
      rule: "gate/consecutive-hyphens",
      severity: "high",
      message: `"${name}" contains consecutive hyphens, which produce an empty segment.`,
    });
  }
  if (findings.length === 0 && !KEBAB.test(name)) {
    findings.push({
      rule: "gate/invalid-character",
      severity: "high",
      message: `"${name}" contains a character outside lowercase letters, digits, and hyphens.`,
    });
  }
  // A name with any of the shape problems above cannot be segmented
  // meaningfully -- reporting a verb or tautology finding on top of it would
  // just add noise to a name that already needs rewriting from scratch.
  if (findings.length > 0) return findings;

  const segments = name.split("-");
  if (segments.length < 2) {
    findings.push({
      rule: "gate/malformed",
      severity: "high",
      message: `"${name}" is not verb-noun. A gate name needs an action and a concrete subject; a bare action or a bare tool name is not enough.`,
    });
    return findings;
  }

  const [verb, ...nouns] = segments as [string, ...string[]];
  const verbs = options.verbs ?? GATE_VERBS;
  if (!verbs.includes(verb)) {
    findings.push({
      rule: "gate/unrecognized-verb",
      severity: "high",
      message: `"${verb}" is not a recognized verb. A gate name's first segment must be the action performed, not its subject or the tool that performs it. Recognized: ${verbs.join(", ")}. Pass options.verbs to extend this vocabulary with a genuinely new one.`,
    });
  }

  for (let i = 0; i < nouns.length; i++) {
    for (let j = i + 1; j < nouns.length; j++) {
      if (sameNounCluster(nouns[i] as string, nouns[j] as string)) {
        findings.push({
          rule: "gate/tautological-noun",
          severity: "medium",
          message: `"${name}" restates "${nouns[i]}" as "${nouns[j]}" instead of narrowing it. Extend verb-noun to verb-noun-noun only where the added segment disambiguates a specific check.`,
        });
      }
    }
  }

  return findings;
}

/**
 * Validate a whole set at once, adding the rule a single name cannot
 * express: two required-status-check contexts publishing the identical name
 * collide in a repository's own branch-protection configuration.
 */
export function validateGateSet(names: readonly string[], options: GateNameOptions = {}): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<unknown>();
  for (const name of names) {
    if (seen.has(name)) {
      findings.push({
        rule: "gate/duplicate",
        severity: "high",
        message: `"${String(name)}" is declared more than once.`,
      });
    }
    seen.add(name);
    findings.push(...validateGateName(name as string, options));
  }
  return findings;
}
