import type { Finding } from "./types.js";

/**
 * Skill naming and ownership: `<owner>-<verb>-<what>`.
 * See `conventions/documents/skill-grammar.md`.
 */

/**
 * Provider namespace for vendor skills shipped with the Foundry package set.
 * A consuming plane must not register this string as a first-party account prefix.
 */
export const CLOSSYS_VENDOR_SKILL_NAMESPACE = "clossys" as const;

/**
 * Published package slugs that may appear as `clossys-<package>` vendor skills.
 * Frozen on purpose — the validator does not read the filesystem.
 */
export const CLOSSYS_VENDOR_SKILL_PACKAGES: readonly string[] = Object.freeze([
  "advisor",
  "architect",
  "bouncer",
  "builder",
  "butler",
  "controller",
  "designer",
  "giver",
  "influencer",
  "inspector",
  "integrator",
  "keeper",
  "launcher",
  "locksmith",
  "messenger",
  "observer",
  "publisher",
  "starter",
  "strategist",
  "writer",
]);

const CLOSSYS_VENDOR_SKILL_PACKAGE_SET: ReadonlySet<string> = new Set(CLOSSYS_VENDOR_SKILL_PACKAGES);

/**
 * A small, literal verb vocabulary. It is closed on purpose. An open vocabulary
 * drifts into synonyms -- `check`, `verify`, `validate`, `assert` for one
 * action -- and a reader can no longer predict a skill's name from what it does,
 * which is the only thing a naming grammar buys.
 */
export const SKILL_VERBS: readonly string[] = Object.freeze([
  "audit",
  "clean",
  "close",
  "create",
  "diagnose",
  "expand",
  "groom",
  "ingest",
  "map",
  "plan",
  "reconcile",
  "review",
  "ship",
  "sync",
  "verify",
]);

const SEGMENT = /^[a-z0-9]+$/;
const PREFIX = /^[a-z]{2,6}$/;
const CLOSSYS_VENDOR_SKILL = /^clossys-([a-z0-9]+)$/;

export interface SkillOptions {
  /**
   * Prefixes registered to an account, e.g. `["ch", "vv"]`. Each account
   * registers exactly one and each prefix belongs to exactly one account; the
   * allocation is a plane's declaration, so it arrives from the caller.
   */
  readonly prefixes: readonly string[];
  /**
   * Provider namespaces already in use. A registered prefix must not collide
   * with one -- the prefix is a safety boundary, and a boundary that can be
   * confused for someone else's namespace is not one.
   */
  readonly reservedNamespaces?: readonly string[];
  /**
   * Third-party skills keep the namespace their maintainer chose. Listing one
   * here exempts it: renaming a vendor's skill to fit a local grammar forks it.
   */
  readonly thirdParty?: readonly string[];
}

function findingsForReservedClossysPrefix(options: SkillOptions): Finding[] {
  if (!options.prefixes.includes(CLOSSYS_VENDOR_SKILL_NAMESPACE)) return [];
  return [
    {
      rule: "skill/prefix-collision",
      severity: "high",
      message: `"${CLOSSYS_VENDOR_SKILL_NAMESPACE}" is a reserved provider namespace for vendor skills (\`${CLOSSYS_VENDOR_SKILL_NAMESPACE}-<package>\`). A consuming plane must not register it as a first-party account prefix.`,
    },
  ];
}

function validateVendorSkillName(name: string, directoryName?: string): Finding[] | null {
  const match = CLOSSYS_VENDOR_SKILL.exec(name);
  if (!match) return null;

  const findings: Finding[] = [];
  const packageSlug = match[1]!;

  if (directoryName !== undefined && directoryName !== name) {
    findings.push({
      rule: "skill/directory-mismatch",
      severity: "high",
      message: `Directory "${directoryName}" and skill name "${name}" must be identical.`,
    });
  }

  if (CLOSSYS_VENDOR_SKILL_PACKAGE_SET.has(packageSlug)) {
    return findings;
  }

  findings.push({
    rule: "skill/unknown-vendor-package",
    severity: "high",
    message: `"${name}" is not a recognized vendor skill. Known packages: ${CLOSSYS_VENDOR_SKILL_PACKAGES.join(", ")}`,
  });
  return findings;
}

/**
 * Validate a first-party skill name. Returns an empty array when it conforms.
 * `directoryName` is compared against the name when supplied, because the
 * directory and the frontmatter `name` drifting apart is the failure that makes
 * a skill silently undiscoverable.
 */
export function validateSkillName(
  name: string,
  options: SkillOptions,
  directoryName?: string,
): Finding[] {
  return validateSkillNameCore(name, options, directoryName, true);
}

/**
 * Validate a whole set at once, adding the cross-cutting rule a single name
 * cannot express: one prefix, one account. Duplicate names are reported here
 * rather than left to a filesystem collision.
 */
export function validateSkillSet(
  names: readonly string[],
  options: SkillOptions,
): Finding[] {
  const findings: Finding[] = [...findingsForReservedClossysPrefix(options)];
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      findings.push({
        rule: "skill/duplicate",
        severity: "high",
        message: `"${name}" is declared more than once.`,
      });
    }
    seen.add(name);
    findings.push(...validateSkillNameCore(name, options, undefined, false));
  }
  return findings;
}

function validateSkillNameCore(
  name: string,
  options: SkillOptions,
  directoryName: string | undefined,
  includeReservedPrefixRegistration: boolean,
): Finding[] {
  const findings: Finding[] = [];

  if (typeof name !== "string" || name.trim() === "") {
    return [{ rule: "skill/empty", severity: "high", message: "Skill name is empty." }];
  }
  if ((options.thirdParty ?? []).includes(name)) return findings;

  if (includeReservedPrefixRegistration) {
    findings.push(...findingsForReservedClossysPrefix(options));
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    findings.push({
      rule: "skill/malformed-segment",
      severity: "high",
      message: `"${name}" must use only lowercase letters, digits, and hyphens.`,
    });
    return findings;
  }

  const vendorFindings = validateVendorSkillName(name, directoryName);
  if (vendorFindings !== null) return vendorFindings;

  if (directoryName !== undefined && directoryName !== name) {
    findings.push({
      rule: "skill/directory-mismatch",
      severity: "high",
      message: `Directory "${directoryName}" and skill name "${name}" must be identical.`,
    });
  }

  const parts = name.split("-");
  if (parts.length < 3) {
    findings.push({
      rule: "skill/malformed",
      severity: "high",
      message: `"${name}" is not <owner>-<verb>-<what>. It needs an owner prefix, a verb, and a concrete subject.`,
    });
    return findings;
  }

  const [prefix, verb, ...what] = parts as [string, string, ...string[]];

  for (const segment of parts) {
    if (!SEGMENT.test(segment)) {
      findings.push({
        rule: "skill/malformed-segment",
        severity: "high",
        message: `"${segment}" in "${name}" must be lowercase alphanumeric.`,
      });
    }
  }

  if (!options.prefixes.includes(prefix)) {
    findings.push({
      rule: "skill/unregistered-prefix",
      severity: "high",
      message: `"${prefix}" is not a registered prefix. Registered: ${
        options.prefixes.length > 0 ? options.prefixes.join(", ") : "(none declared)"
      }`,
    });
  } else if (!PREFIX.test(prefix)) {
    findings.push({
      rule: "skill/prefix-not-abbreviation",
      severity: "medium",
      message: `"${prefix}" should be a short lowercase abbreviation of its account (2-6 letters).`,
    });
  }

  const reservedNamespaces = new Set([
    CLOSSYS_VENDOR_SKILL_NAMESPACE,
    ...(options.reservedNamespaces ?? []),
  ]);
  if (reservedNamespaces.has(prefix)) {
    findings.push({
      rule: "skill/prefix-collision",
      severity: "high",
      message: `"${prefix}" collides with a provider namespace already in use. A prefix is a safety boundary, so it must be unambiguous.`,
    });
  }

  if (!SKILL_VERBS.includes(verb)) {
    findings.push({
      rule: "skill/unknown-verb",
      severity: "high",
      message: `"${verb}" is not in the verb vocabulary. Use one of: ${SKILL_VERBS.join(", ")}`,
    });
  }

  if (what.length === 0 || what.join("") === "") {
    findings.push({
      rule: "skill/missing-subject",
      severity: "high",
      message: `"${name}" names no subject. The final term answers what the skill acts on.`,
    });
  }

  return findings;
}
