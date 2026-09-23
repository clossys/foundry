/**
 * The weekly Sunday `@clossys/*` adoption convention for consuming
 * repositories (issue #1259's own CI conventions, extended per #1187/#1259's
 * cadence rule): a consuming repository updates its `@clossys/*` dependency
 * ranges through exactly one grouped pull request per week, scheduled for
 * Sunday in the repository's own declared timezone -- the day after this
 * repository's own Saturday release wave -- via whichever updater the
 * repository already runs (Renovate or Dependabot). A security advisory for
 * `@clossys/*` bypasses that schedule and applies immediately; no other
 * automation may bump a `@clossys/*` range on any other day; and the
 * resulting adoption pull request runs the repository's normal required
 * checks plus `integrator-provenance-check` (#885/#1169) before it merges.
 *
 * This module is the pure evaluator for that convention, the same "caller
 * already read the file, this module does no I/O" discipline `./ci-
 * conventions.ts` holds for workflow YAML: `evaluateWeeklyAdoption` takes an
 * already-read updater config file's raw text plus a declared timezone and
 * the repository's declared required contexts, and returns one
 * `WeeklyAdoptionRuleResult` per rule -- `"satisfied"`, `"missing"`, or
 * `"violated"`, `./ci-conventions.ts`'s own three-state vocabulary for this
 * convention (distinct from `RunnerCheckState`'s `"indeterminate"`: a
 * config that simply does not exist yet is a gap to close, not a question
 * that could not be answered). `./ci-conventions.ts`'s `checkWeeklyAdoption`
 * is the thin wrapper that folds these results into the shared check-output
 * envelope, mirroring how it already wraps `validateRunnerLabel` and
 * `validateGateName`.
 *
 * Config parsing is deliberately narrow, matching `./yaml-lite.ts`'s own
 * "small, well-tested subset" philosophy rather than a general parser:
 * Renovate config is read as strict JSON (an illustrative caller path like
 * `.github/renovate.json` -- JSON5 comments and `renovate.json5`'s relaxed
 * syntax are out of scope, same as this package's zero-runtime-dependency
 * constraint already holds for YAML); Dependabot config is read with
 * `./yaml-lite.ts`, the same parser `./ci-conventions.ts` already uses for
 * workflow files, because an illustrative caller path like `.github/
 * dependabot.yml` (that exact path does not ship with this package) uses
 * exactly the block-mapping/block-sequence subset that parser supports.
 */

import { parseYamlLite, YamlLiteParseError, type YamlValue } from "./yaml-lite.js";

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export type UpdaterKind = "renovate" | "dependabot";

/** An already-read updater config file -- `path` is an illustrative example of a caller's own repository-relative path, such as `.github/renovate.json` or `.github/dependabot.yml`; this package does not ship either example path itself. */
export interface UpdaterConfigFile {
  readonly path: string;
  readonly content: string;
  readonly kind: UpdaterKind;
}

export interface WeeklyAdoptionDeclaration {
  /**
   * Whether this convention applies to this repository at all. A package
   * PRODUCER -- this repository is the running example -- never consumes
   * its own `@clossys/*` packages and declares `applies: false` (or omits
   * `weeklyAdoption` from `CiConventionsDeclaration` entirely); every
   * `ci/weekly-adoption-*` rule is then skipped as not applicable, never
   * reported as a gap. A consuming repository declares `true`.
   */
  readonly applies: boolean;
  /**
   * The IANA timezone name this repository has declared "Sunday" against,
   * e.g. `"America/Los_Angeles"`. Required when `applies` is true --
   * `evaluateWeeklyAdoption` reports `ci/weekly-adoption-no-timezone-
   * declared` (missing) when it is absent, because "Sunday" is not a
   * well-defined day without one.
   */
  readonly timezone?: string;
  /** The repository's own updater config, when one exists. Absent -> `ci/weekly-adoption-no-updater-configured`. */
  readonly updaterConfig?: UpdaterConfigFile;
  /**
   * Required-status-check context names the adoption pull request runs.
   * Defaults to `CiConventionsRuleset.requiredContexts` when omitted -- set
   * this only when the adoption PR's own required-context set genuinely
   * differs from the repository's ordinary one.
   */
  readonly adoptionPrRequiredContexts?: readonly string[];
  /**
   * The required-status-check context name that runs `integrator-
   * provenance-check` (#885/#1169). Defaults to the literal string
   * `"integrator-provenance-check"` -- most consuming repositories name the
   * context after the installed CLI directly, for discoverability across
   * every consumer, a narrow and deliberate exception to `gate-naming.md`'s
   * own "a scanning tool's own name is not the gate that runs it" rule
   * (that document governs a repository's OWN authored checks; this is a
   * shared, cross-repository identifier every consumer recognizes on
   * sight). A repository that instead wraps the tool behind a conformant
   * gate name (e.g. `"verify-package-provenance"`) declares that name here.
   */
  readonly provenanceCheckContext?: string;
}

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export type WeeklyAdoptionRuleState = "satisfied" | "missing" | "violated";

export interface WeeklyAdoptionRuleResult {
  readonly rule: string;
  readonly state: WeeklyAdoptionRuleState;
  readonly message: string;
}

const CLOSSYS_MARKER = "@clossys";

function includesClossys(value: unknown): boolean {
  return typeof value === "string" && value.includes(CLOSSYS_MARKER);
}

function isPlainObject(value: YamlValue | undefined): value is { [key: string]: YamlValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.filter((v): v is string => typeof v === "string");
}

function scheduleMentionsSunday(schedule: unknown): boolean {
  const entries = asStringArray(schedule);
  return entries.some((s) => /\bsunday\b/i.test(s));
}

// ---------------------------------------------------------------------------
// Rule 4: integrator-provenance-check among the adoption PR's required
// contexts -- independent of which updater (or none) is configured.
// ---------------------------------------------------------------------------

const RULE_PROVENANCE_CHECK = "ci/weekly-adoption-provenance-check-required";

function checkProvenanceCheckRequired(
  requiredContexts: readonly string[],
  provenanceCheckContext: string,
): WeeklyAdoptionRuleResult {
  if (requiredContexts.includes(provenanceCheckContext)) {
    return {
      rule: RULE_PROVENANCE_CHECK,
      state: "satisfied",
      message: `"${provenanceCheckContext}" is among the adoption pull request's required contexts.`,
    };
  }
  return {
    rule: RULE_PROVENANCE_CHECK,
    state: "missing",
    message: `integrator-provenance-check (#885/#1169) -- declared context "${provenanceCheckContext}" -- is not among the adoption pull request's required contexts -- add it alongside this repository's normal required checks before the adoption PR can merge.`,
  };
}

// ---------------------------------------------------------------------------
// Renovate
// ---------------------------------------------------------------------------

interface RenovatePackageRule {
  readonly matchPackageNames?: unknown;
  readonly matchPackagePatterns?: unknown;
  readonly matchPackagePrefixes?: unknown;
  readonly groupName?: unknown;
  readonly schedule?: unknown;
  readonly [key: string]: unknown;
}

interface RenovateConfig {
  readonly packageRules?: readonly RenovatePackageRule[];
  readonly schedule?: unknown;
  readonly vulnerabilityAlerts?: { readonly schedule?: unknown; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

function packageRuleMatchesClossys(rule: RenovatePackageRule): boolean {
  const candidates = [
    ...asStringArray(rule.matchPackageNames),
    ...asStringArray(rule.matchPackagePatterns),
    ...asStringArray(rule.matchPackagePrefixes),
  ];
  return candidates.some(includesClossys);
}

function evaluateRenovate(content: string): WeeklyAdoptionRuleResult[] {
  let config: RenovateConfig;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("document root is not a JSON object");
    }
    config = parsed as RenovateConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unparsable: WeeklyAdoptionRuleResult = {
      rule: RULE_GROUPED_SCHEDULE,
      state: "violated",
      message: `Renovate config could not be parsed as JSON: ${message}. This evaluator reads a strict-JSON renovate.json -- renovate.json5's relaxed syntax and comments are not supported.`,
    };
    return [unparsable, { ...unparsable, rule: RULE_SECURITY_BYPASS }, { ...unparsable, rule: RULE_NO_OTHER_AUTOMATION }];
  }

  const packageRules = Array.isArray(config.packageRules) ? config.packageRules : [];
  const matches = packageRules.filter(packageRuleMatchesClossys);

  const results: WeeklyAdoptionRuleResult[] = [];

  if (matches.length === 0) {
    results.push({
      rule: RULE_GROUPED_SCHEDULE,
      state: "missing",
      message:
        'No packageRules entry matches "@clossys/" packages -- add one with a groupName and a Sunday schedule (see ci-conventions.md for a minimal example).',
    });
    results.push({
      rule: RULE_NO_OTHER_AUTOMATION,
      state: "missing",
      message: "No packageRules entry manages @clossys/* packages at all, so this rule could not be evaluated -- see the grouped-schedule finding above.",
    });
  } else {
    const primary = matches[0] as RenovatePackageRule;
    if (typeof primary.groupName !== "string" || primary.groupName.length === 0) {
      results.push({
        rule: RULE_GROUPED_SCHEDULE,
        state: "violated",
        message:
          "A packageRules entry matches @clossys/* packages but sets no groupName -- updates would land as separate pull requests, not the required one grouped PR per week.",
      });
    } else if (!scheduleMentionsSunday(primary.schedule ?? config.schedule)) {
      results.push({
        rule: RULE_GROUPED_SCHEDULE,
        state: "violated",
        message:
          'The @clossys/* packageRules entry ("' +
          primary.groupName +
          '") has no Sunday schedule -- set schedule to something like ["on sunday"] (or ["before 6am on sunday"]) in the repository\'s declared timezone.',
      });
    } else {
      results.push({
        rule: RULE_GROUPED_SCHEDULE,
        state: "satisfied",
        message: `The @clossys/* packageRules entry ("${primary.groupName}") is grouped and scheduled for Sunday.`,
      });
    }

    if (matches.length > 1) {
      results.push({
        rule: RULE_NO_OTHER_AUTOMATION,
        state: "violated",
        message: `${matches.length} packageRules entries match @clossys/* packages -- only the one grouped Sunday rule may; consolidate the others into it or narrow their match patterns.`,
      });
    } else {
      results.push({
        rule: RULE_NO_OTHER_AUTOMATION,
        state: "satisfied",
        message: "Exactly one packageRules entry manages @clossys/* packages.",
      });
    }
  }

  const vulnSchedule = config.vulnerabilityAlerts?.schedule;
  if (vulnSchedule === undefined) {
    results.push({
      rule: RULE_SECURITY_BYPASS,
      state: "satisfied",
      message: "No vulnerabilityAlerts.schedule override is set -- Renovate applies security advisories immediately by default, bypassing the weekly schedule.",
    });
  } else {
    const entries = asStringArray(vulnSchedule);
    const bypasses = entries.length === 0 || entries.some((s) => /at any time/i.test(s));
    if (bypasses) {
      results.push({
        rule: RULE_SECURITY_BYPASS,
        state: "satisfied",
        message: "vulnerabilityAlerts.schedule is set to bypass the weekly schedule -- security advisories for @clossys/* apply immediately.",
      });
    } else {
      results.push({
        rule: RULE_SECURITY_BYPASS,
        state: "violated",
        message:
          'vulnerabilityAlerts.schedule restricts security updates to a schedule -- security advisories for @clossys/* must bypass the weekly schedule and apply immediately. Remove the override or set it to ["at any time"].',
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Dependabot
// ---------------------------------------------------------------------------

function dependabotUpdates(doc: { [key: string]: YamlValue }): Array<{ [key: string]: YamlValue }> {
  const updates = doc.updates;
  if (!Array.isArray(updates)) return [];
  return updates.filter(isPlainObject);
}

function dependabotGroupsMatchingClossys(update: { [key: string]: YamlValue }): string[] {
  const groups = update.groups;
  if (!isPlainObject(groups)) return [];
  const matching: string[] = [];
  for (const [groupName, groupValue] of Object.entries(groups)) {
    if (!isPlainObject(groupValue)) continue;
    const patterns = [...asStringArray(groupValue.patterns), ...asStringArray(groupValue["package-patterns"])];
    if (patterns.some(includesClossys)) matching.push(groupName);
  }
  return matching;
}

function evaluateDependabot(content: string): WeeklyAdoptionRuleResult[] {
  let doc: { [key: string]: YamlValue };
  try {
    const parsed = parseYamlLite(content);
    if (!isPlainObject(parsed)) throw new Error("document root did not parse to a mapping");
    doc = parsed;
  } catch (error) {
    const message = error instanceof YamlLiteParseError ? error.message : error instanceof Error ? error.message : String(error);
    const unparsable: WeeklyAdoptionRuleResult = {
      rule: RULE_GROUPED_SCHEDULE,
      state: "violated",
      message: `Dependabot config could not be parsed: ${message}`,
    };
    return [unparsable, { ...unparsable, rule: RULE_SECURITY_BYPASS }, { ...unparsable, rule: RULE_NO_OTHER_AUTOMATION }];
  }

  const updates = dependabotUpdates(doc);
  const results: WeeklyAdoptionRuleResult[] = [];

  interface Matched {
    readonly index: number;
    readonly groupName: string;
    readonly update: { [key: string]: YamlValue };
  }
  const matched: Matched[] = [];
  updates.forEach((update, index) => {
    for (const groupName of dependabotGroupsMatchingClossys(update)) {
      matched.push({ index, groupName, update });
    }
  });

  if (matched.length === 0) {
    results.push({
      rule: RULE_GROUPED_SCHEDULE,
      state: "missing",
      message:
        'No updates entry groups "@clossys/*" packages -- add a groups entry with a pattern matching "@clossys/*" and a weekly Sunday schedule (see ci-conventions.md for a minimal example).',
    });
    results.push({
      rule: RULE_NO_OTHER_AUTOMATION,
      state: "missing",
      message: "No updates entry manages @clossys/* packages at all, so this rule could not be evaluated -- see the grouped-schedule finding above.",
    });
  } else {
    const primary = matched[0] as Matched;
    const schedule = primary.update.schedule;
    const interval = isPlainObject(schedule) ? schedule.interval : undefined;
    const day = isPlainObject(schedule) ? schedule.day : undefined;
    if (interval !== "weekly") {
      results.push({
        rule: RULE_GROUPED_SCHEDULE,
        state: "violated",
        message: `The "${primary.groupName}" group's schedule.interval is ${JSON.stringify(interval ?? null)}, not "weekly" -- Dependabot groups @clossys/* updates into exactly one pull request per week.`,
      });
    } else if (typeof day !== "string" || day.toLowerCase() !== "sunday") {
      results.push({
        rule: RULE_GROUPED_SCHEDULE,
        state: "violated",
        message: `The "${primary.groupName}" group's schedule.day is ${JSON.stringify(day ?? null)}, not "sunday".`,
      });
    } else {
      results.push({
        rule: RULE_GROUPED_SCHEDULE,
        state: "satisfied",
        message: `The "${primary.groupName}" group is scheduled weekly on Sunday.`,
      });
    }

    if (matched.length > 1) {
      results.push({
        rule: RULE_NO_OTHER_AUTOMATION,
        state: "violated",
        message: `${matched.length} groups across this config match @clossys/* packages -- only the one grouped Sunday group may.`,
      });
    } else {
      // A second updates entry (a different package-ecosystem/directory
      // pair) could still bump @clossys/* packages on its own schedule if
      // it neither groups nor ignores them -- check every OTHER entry.
      const strays: string[] = [];
      updates.forEach((update, index) => {
        if (index === primary.index) return;
        const ecosystem = update["package-ecosystem"];
        if (ecosystem !== "npm") return; // only an npm ecosystem entry can touch an npm-published @clossys/* range
        const groupsHereMatch = dependabotGroupsMatchingClossys(update).length > 0;
        const ignore = Array.isArray(update.ignore) ? update.ignore.filter(isPlainObject) : [];
        const ignoresClossys = ignore.some((entry) => includesClossys(entry["dependency-name"]));
        if (!groupsHereMatch && !ignoresClossys) {
          const directory = typeof update.directory === "string" ? update.directory : "?";
          strays.push(`updates[${index}] (npm, directory "${directory}")`);
        }
      });
      if (strays.length > 0) {
        results.push({
          rule: RULE_NO_OTHER_AUTOMATION,
          state: "violated",
          message: `${strays.join(", ")} could still bump @clossys/* ranges outside the grouped Sunday schedule -- add an "ignore" entry for "@clossys/*" there, or fold it into the grouped group.`,
        });
      } else {
        results.push({
          rule: RULE_NO_OTHER_AUTOMATION,
          state: "satisfied",
          message: "No other updates entry can bump @clossys/* ranges outside the grouped Sunday schedule.",
        });
      }
    }
  }

  // Dependabot has no in-file lever for security-update timing: security
  // updates are a repository-level Dependabot alerts setting, entirely
  // separate from dependabot.yml's version-update schedule, and always
  // apply immediately regardless of what this file declares -- so this
  // rule is satisfied by the platform's own default, unconditionally.
  results.push({
    rule: RULE_SECURITY_BYPASS,
    state: "satisfied",
    message: "Dependabot security updates are a separate, repository-level setting from this file's version-update schedule, and always apply immediately.",
  });

  return results;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export const RULE_GROUPED_SCHEDULE = "ci/weekly-adoption-grouped-schedule";
export const RULE_SECURITY_BYPASS = "ci/weekly-adoption-security-bypass";
export const RULE_NO_OTHER_AUTOMATION = "ci/weekly-adoption-no-other-automation";
export const RULE_PROVENANCE_CHECK_REQUIRED = RULE_PROVENANCE_CHECK;
export const RULE_NO_TIMEZONE_DECLARED = "ci/weekly-adoption-no-timezone-declared";
export const RULE_NO_UPDATER_CONFIGURED = "ci/weekly-adoption-no-updater-configured";

/**
 * Evaluates the weekly Sunday `@clossys/*` adoption convention. Returns one
 * result per rule -- always four when `updaterConfig` is present and parses,
 * fewer when it is absent (the config-dependent rules collapse to a single
 * `missing` result each) or unparsable (they collapse to a single
 * `violated` result each). `requiredContexts` is `declaration
 * .adoptionPrRequiredContexts ?? ruleset.requiredContexts` -- the caller's
 * job, not this function's, exactly like every other `./ci-conventions.ts`
 * rule that reads `CiConventionsRuleset`.
 */
export function evaluateWeeklyAdoption(
  declaration: WeeklyAdoptionDeclaration,
  requiredContexts: readonly string[],
): readonly WeeklyAdoptionRuleResult[] {
  const results: WeeklyAdoptionRuleResult[] = [];

  if (declaration.timezone === undefined || declaration.timezone.length === 0) {
    results.push({
      rule: RULE_NO_TIMEZONE_DECLARED,
      state: "missing",
      message: 'No timezone is declared -- "Sunday" is not well-defined without one. Declare the IANA timezone name this repository schedules its adoption PR in.',
    });
  }

  if (!declaration.updaterConfig) {
    results.push({
      rule: RULE_NO_UPDATER_CONFIGURED,
      state: "missing",
      message: "No updater config was supplied -- neither Renovate nor Dependabot is configured to group and schedule @clossys/* updates.",
    });
  } else {
    const { kind, content } = declaration.updaterConfig;
    results.push(...(kind === "renovate" ? evaluateRenovate(content) : evaluateDependabot(content)));
  }

  results.push(checkProvenanceCheckRequired(requiredContexts, declaration.provenanceCheckContext ?? "integrator-provenance-check"));

  return results;
}
