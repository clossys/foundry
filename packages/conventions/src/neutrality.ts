import type { Finding } from "./types.js";

/**
 * Neutrality: the publishing precondition for shared agent conventions.
 *
 * Material that two parties who do not govern each other both depend on is the
 * only thing either can safely share, which is why it ends up public -- and a
 * private name pushed somewhere public is cached and indexed whether or not it
 * is later deleted. So this scan is deliberately biased toward reporting: a
 * false report costs a reword, and a missed name cannot be taken back.
 *
 * It checks *structure*, not identity. Identity -- a person, an account, a
 * client -- needs a denylist, which is necessarily private and belongs to
 * whoever holds the names. Pass those in through `forbiddenNames` when you have
 * them. What is checkable without any list is whether the content names a path
 * that only exists on one machine, and that is what runs by default.
 */

/**
 * An absolute path -- written so that this file does not itself contain one.
 *
 * The lookbehind is the whole subtlety. A word character, dot, hyphen,
 * asterisk, or slash before the separator means the match is a relative
 * reference, a version, a cron field, or a URL scheme rather than a path. A
 * tilde is excluded because a home-relative path is judged by the rule below,
 * which correctly permits a product's own dot-directory.
 *
 * Two closing brackets are excluded for the same reason as each other: neutral
 * material describes layout with placeholders, and a segment following one is
 * relative by construction. `>` covers the prose form (`<repository>/.claude/`);
 * `}` covers the template form (`${WORKSPACE_ROOT}/personal`). Without `}` the
 * scan reports `/personal` on exactly the templated content that exists to make
 * the material neutral in the first place -- penalizing the fix.
 */
const ABSOLUTE_PATH = /(?<![\w.\-*/~>}])\/[A-Za-z0-9._][A-Za-z0-9._-]*/;

/**
 * A named, non-hidden directory in someone's home is that person's layout
 * choice. A product's own dot-directory is true for every operator of that
 * product, so the negative lookahead deliberately permits it.
 */
const NAMED_HOME_DIRECTORY = /~\/(?!\.)[A-Za-z0-9._-]+/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface NeutralityOptions {
  /**
   * Names owned by a plane rather than by a convention: accounts, repositories,
   * people, machines. Matched case-insensitively on word boundaries, because
   * nobody defends a name by changing its capitalization.
   */
  readonly forbiddenNames?: readonly string[];
  /**
   * Allow `${TOKEN}` placeholders. They are how a neutral document stays
   * concrete after provisioning, so they are permitted by default.
   */
  readonly allowTemplateTokens?: boolean;
}

/**
 * Scan one document's content. Returns an empty array when it is neutral.
 */
export function scanNeutrality(contents: string, options: NeutralityOptions = {}): Finding[] {
  const findings: Finding[] = [];

  // A shebang is the one absolute path that is not a layout choice: the kernel
  // requires it, and it is the same on every machine running that interpreter.
  // Only the first line is exempt, so an absolute path in a script's *body*
  // still reports -- an interpreter tool found at a package manager's install
  // prefix is exactly the operator-specific path this rule exists to catch.
  const scannable = contents.startsWith("#!")
    ? contents.slice(contents.indexOf("\n") + 1 || contents.length)
    : contents;

  const absolute = ABSOLUTE_PATH.exec(scannable);
  if (absolute) {
    findings.push({
      rule: "neutrality/absolute-path",
      severity: "high",
      message: `Names an absolute path (${absolute[0].trim()}). A path that exists on one machine is that operator's layout, not a shared convention.`,
    });
  }

  const home = NAMED_HOME_DIRECTORY.exec(contents);
  if (home) {
    findings.push({
      rule: "neutrality/named-home-directory",
      severity: "high",
      message: `Names a directory in an operator's home (${home[0].trim()}). A product's own dot-directory is neutral; a named one is a layout choice.`,
    });
  }

  if (options.allowTemplateTokens === false && /\$\{[A-Z_]+\}/.test(contents)) {
    findings.push({
      rule: "neutrality/template-token",
      severity: "medium",
      message:
        "Contains a ${TOKEN} placeholder, but this content was scanned as already-expanded. An unexpanded token here means it was installed without templating.",
    });
  }

  for (const name of options.forbiddenNames ?? []) {
    if (!name) continue;
    if (new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(contents)) {
      findings.push({
        rule: "neutrality/plane-owned-name",
        severity: "high",
        message: `Names "${name}", which belongs to a plane rather than to a convention.`,
      });
    }
  }

  return findings;
}
