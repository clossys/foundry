/**
 * `ci-conventions-check`: the pure evaluator for `conventions/documents/
 * ci-conventions.md` (issue #1259).
 *
 * Every fact this module needs is supplied by the caller: the workflow
 * files' raw text, the ruleset (which required contexts exist and what a
 * conforming workflow looks like), a declaration (repository visibility,
 * plan, budget, and any reasoned exceptions), and -- only when a projected
 * minutes figure is wanted -- dated runner pricing data. This module does
 * no I/O of its own: no filesystem read, no network call. `./yaml-lite.ts`
 * is the one piece of non-trivial work it does internally, and that is
 * parsing, not I/O -- transforming a string the caller already read into a
 * structure this module can walk.
 *
 * The output is the shared output envelope (issue #1190 / #1174,
 * `docs/contracts/check-output-envelope.json` -- that repo-root contract
 * path does not ship with this package): `{ package, version,
 * verdict, summary, findings, metric?, nextAction? }`, with `verdict` one
 * of this package's own three-state ternary (`satisfied` / `violated` /
 * `indeterminate`, `./gates/result.ts`) and each finding's `severity` one
 * of the envelope's own two levels (`error` / `warning` -- not this
 * package's `Finding.severity` `high`/`medium`/`low`, which several other
 * `conventions` modules use; this module maps into the envelope's own
 * vocabulary at its boundary, high/medium collapsing to error/warning,
 * because this is the first module in this package required to emit the
 * envelope directly rather than its own local shape). No package has
 * shipped this envelope before this module -- see #1187's own coordination
 * comment on the normalization direction that makes this the shape to
 * match, not a parallel invention.
 *
 * `declaration.weeklyAdoption` (`./weekly-adoption.ts`) extends this
 * evaluator with the weekly Sunday `@clossys/*` adoption convention for
 * consuming repositories (#1187/#1259's cadence rule): grouped weekly
 * Sunday dependency updates via Renovate or Dependabot, an immediate bypass
 * for security advisories, no other automation touching `@clossys/*` on any
 * other day, and `integrator-provenance-check` (#885/#1169) required on the
 * adoption pull request. Omitted entirely -- this package's own declaration
 * included, since it produces `@clossys/*` rather than consuming it -- the
 * rule set is skipped as not applicable, never reported as a gap.
 */

import type { GateNameOptions } from "./gates.js";
import { validateGateName } from "./gates.js";
import type { JobDefinition, RunnerConventions } from "./runner.js";
import { validateRunnerLabel } from "./runner.js";
import { evaluateWeeklyAdoption, type WeeklyAdoptionDeclaration } from "./weekly-adoption.js";
import { YamlLiteParseError, parseYamlLite, type YamlValue } from "./yaml-lite.js";

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

/** One workflow file's path (repo-relative) and raw text, exactly as the caller read it. */
export interface WorkflowFile {
  readonly path: string;
  readonly content: string;
}

/** A reasoned, declared exception to one rule -- never a silent skip. */
export interface JustifiedException {
  /** The rule id this exception covers, e.g. `"ci/missing-timeout-minutes"`. */
  readonly rule: string;
  /**
   * Narrows the exception to findings whose `path` contains this substring
   * (a workflow path, a `workflow#job`, or similar). Omit to cover every
   * finding for `rule`.
   */
  readonly scope?: string;
  readonly reason: string;
  readonly issue?: number;
}

/** Dated runner pricing, shaped like `conventions/data/runner-pricing.json`. Never hard-coded. */
export interface RunnerPricingData {
  readonly asOf: string;
  readonly sources?: readonly string[];
  readonly githubHosted: {
    readonly privateRepos: {
      readonly freeMinutesAllowance: {
        readonly free: number;
        readonly team: number;
        readonly enterpriseCloud: number;
      };
    };
  };
  readonly blacksmith: {
    readonly freeMinutesAllowance: {
      readonly allPlans: number;
    };
  };
}

export interface CiConventionsRuleset {
  /** Required-status-check context names this repository declares. */
  readonly requiredContexts: readonly string[];
  /** Extends `GATE_VERBS` for `validateGateName`, when a repository has a genuinely new verb. */
  readonly gateNameOptions?: GateNameOptions;
  /** Ceiling for `retention-days` on an `actions/upload-artifact` step. */
  readonly maxRetentionDays: number;
  /**
   * Workflow basenames (e.g. `"publish.yml"`) that are never allowed
   * `cancel-in-progress: true` regardless of their trigger shape, because
   * they run on `main` or execute a release/publish. A workflow triggered
   * on `push` to a `declaration.protectedBranches` branch is already
   * covered without appearing here.
   */
  readonly protectedRefWorkflows?: readonly string[];
}

export interface CiConventionsDeclaration {
  readonly visibility: "public" | "private";
  readonly plan?: "free" | "team" | "enterpriseCloud";
  /** Branches a `push` trigger on them makes a workflow "protected" for the cancel-in-progress rule. Defaults to `["main"]`. */
  readonly protectedBranches?: readonly string[];
  /** Maps a required context name (`ruleset.requiredContexts` entry) to the workflow path that publishes it. */
  readonly requiredContextWorkflows?: Readonly<Record<string, string>>;
  /** The identifier `RunnerConventions.publicRepos` exempts, e.g. the repository name. Required for the runner-label rule to resolve a public-repository exemption. */
  readonly repositoryIdentifier?: string;
  readonly runnerConventions?: RunnerConventions;
  /** Declared monthly minutes budget. Private repositories only -- see `ci-conventions.md`. */
  readonly monthlyMinutesBudget?: number;
  /** A projected monthly minutes figure, supplied by the caller (e.g. Observer's run history, #484). Optional -- omitted, the budget rule is skipped, not reported as a gap. */
  readonly runHistoryMinutes?: number;
  readonly justifiedExceptions?: readonly JustifiedException[];
  /**
   * The weekly Sunday `@clossys/*` adoption convention declaration (`./
   * weekly-adoption.ts`). Omitted entirely -- the default -- means every
   * `ci/weekly-adoption-*` rule is skipped as not applicable, e.g. for a
   * repository (this one included) that produces `@clossys/*` packages
   * rather than consuming them. Present with `applies: true`, it is
   * evaluated; see `checkWeeklyAdoption` below.
   */
  readonly weeklyAdoption?: WeeklyAdoptionDeclaration;
}

export interface EvaluateCiConventionsInput {
  readonly workflowFiles: readonly WorkflowFile[];
  readonly ruleset: CiConventionsRuleset;
  readonly declaration: CiConventionsDeclaration;
  readonly pricing?: RunnerPricingData;
  /** The exact published version of the package producing this report (envelope's own `version` field). */
  readonly packageVersion: string;
}

// ---------------------------------------------------------------------------
// Output shapes: the shared check-output envelope (#1190 / #1174)
// ---------------------------------------------------------------------------

export type CiConventionsVerdict = "satisfied" | "violated" | "indeterminate";

export interface CheckFinding {
  readonly rule: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly path?: string;
}

export interface CheckMetric {
  readonly name: string;
  readonly value: number;
  readonly direction: "increase" | "decrease" | "maintain" | "target-range";
}

export interface CheckOutputEnvelope {
  readonly package: string;
  readonly version: string;
  readonly verdict: CiConventionsVerdict;
  readonly summary: string;
  readonly findings: readonly CheckFinding[];
  readonly metric?: CheckMetric;
  readonly nextAction?: string;
}

const PACKAGE_NAME = "@clossys/controller";

// ---------------------------------------------------------------------------
// Small structural helpers over the parsed YAML
// ---------------------------------------------------------------------------

function isPlainObject(value: YamlValue | undefined): value is { [key: string]: YamlValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: YamlValue | undefined): YamlValue[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

interface ParsedWorkflow {
  readonly path: string;
  readonly doc: { [key: string]: YamlValue };
}

interface ParseOutcome {
  readonly parsed: readonly ParsedWorkflow[];
  readonly findings: CheckFinding[];
}

function parseWorkflows(files: readonly WorkflowFile[]): ParseOutcome {
  const parsed: ParsedWorkflow[] = [];
  const findings: CheckFinding[] = [];
  for (const file of files) {
    try {
      const doc = parseYamlLite(file.content);
      if (!isPlainObject(doc)) {
        findings.push({
          rule: "ci/unparsable-workflow",
          severity: "error",
          message: `${file.path} did not parse to a mapping at the document root.`,
          path: file.path,
        });
        continue;
      }
      parsed.push({ path: file.path, doc });
    } catch (error) {
      const message = error instanceof YamlLiteParseError ? error.message : String(error);
      findings.push({
        rule: "ci/unparsable-workflow",
        severity: "error",
        message: `${file.path} could not be parsed: ${message}`,
        path: file.path,
      });
    }
  }
  return { parsed, findings };
}

function triggerNames(on: YamlValue | undefined): Set<string> {
  if (on === undefined || on === null) return new Set();
  if (typeof on === "string") return new Set([on]);
  if (Array.isArray(on)) return new Set(on.filter((v): v is string => typeof v === "string"));
  if (isPlainObject(on)) return new Set(Object.keys(on));
  return new Set();
}

function jobsOf(doc: { [key: string]: YamlValue }): Array<{ name: string; job: { [key: string]: YamlValue } }> {
  const jobs = doc.jobs;
  if (!isPlainObject(jobs)) return [];
  const result: Array<{ name: string; job: { [key: string]: YamlValue } }> = [];
  for (const [name, value] of Object.entries(jobs)) {
    if (isPlainObject(value)) result.push({ name, job: value });
  }
  return result;
}

function stepsOf(job: { [key: string]: YamlValue }): Array<{ [key: string]: YamlValue }> {
  return asArray(job.steps).filter(isPlainObject);
}

const SHA_PIN = /@([0-9a-f]{40})(\s|$)/i;

// ---------------------------------------------------------------------------
// Rule 1: PR-only cancel-in-progress
// ---------------------------------------------------------------------------

function checkCancelInProgress(
  workflow: ParsedWorkflow,
  ruleset: CiConventionsRuleset,
  declaration: CiConventionsDeclaration,
): CheckFinding[] {
  const concurrency = workflow.doc.concurrency;
  if (!isPlainObject(concurrency) || concurrency["cancel-in-progress"] !== true) return [];

  const basename = workflow.path.split("/").pop() ?? workflow.path;
  const protectedRef = (ruleset.protectedRefWorkflows ?? []).includes(basename);

  const triggers = triggerNames(workflow.doc.on);
  const protectedBranches = declaration.protectedBranches ?? ["main"];
  let pushToProtectedBranch = false;
  if (triggers.has("push")) {
    const on = workflow.doc.on;
    const pushConfig = isPlainObject(on) ? on.push : undefined;
    const branches = isPlainObject(pushConfig) ? asArray(pushConfig.branches) : [];
    pushToProtectedBranch =
      branches.length === 0 || branches.some((b) => typeof b === "string" && protectedBranches.includes(b));
  }

  if (protectedRef || pushToProtectedBranch) {
    return [
      {
        rule: "ci/cancel-in-progress-on-protected-ref",
        severity: "error",
        message: `${workflow.path} sets cancel-in-progress: true but runs on a protected ref (push to ${protectedBranches.join(
          ", ",
        )}, or a declared protected-ref workflow) -- a later run can cancel a commit's own verification before it completes.`,
        path: workflow.path,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Rule 2: timeout-minutes present on every job
// ---------------------------------------------------------------------------

function checkTimeoutMinutes(workflow: ParsedWorkflow): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const { name, job } of jobsOf(workflow.doc)) {
    if (typeof job["timeout-minutes"] !== "number") {
      findings.push({
        rule: "ci/missing-timeout-minutes",
        severity: "error",
        message: `Job "${name}" in ${workflow.path} declares no timeout-minutes -- a hung run can hold a runner slot for up to GitHub's own ceiling.`,
        path: `${workflow.path}#${name}`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 3: third-party actions pinned by full commit SHA
// ---------------------------------------------------------------------------

function checkShaPinning(workflow: ParsedWorkflow): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const { name, job } of jobsOf(workflow.doc)) {
    for (const step of stepsOf(job)) {
      const uses = step.uses;
      if (typeof uses !== "string" || uses.startsWith("./") || uses.startsWith("docker://")) continue;
      if (!SHA_PIN.test(`${uses} `)) {
        findings.push({
          rule: "ci/unpinned-action",
          severity: "error",
          message: `Job "${name}" in ${workflow.path} uses "${uses}", not pinned to a full 40-character commit SHA -- a tag or branch ref can be silently repointed.`,
          path: `${workflow.path}#${name}`,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 4: top-level permissions declared
// ---------------------------------------------------------------------------

function checkTopLevelPermissions(workflow: ParsedWorkflow): CheckFinding[] {
  if (workflow.doc.permissions === undefined) {
    return [
      {
        rule: "ci/missing-top-level-permissions",
        severity: "error",
        message: `${workflow.path} declares no top-level permissions: -- it inherits the repository's (or org's) default token scope, which is frequently broader than any job needs.`,
        path: workflow.path,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Rule 5 & 6: required contexts on both pull_request and merge_group, no path filters
// ---------------------------------------------------------------------------

function checkRequiredContextTriggers(
  ruleset: CiConventionsRuleset,
  declaration: CiConventionsDeclaration,
  byPath: ReadonlyMap<string, ParsedWorkflow>,
): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const mapping = declaration.requiredContextWorkflows ?? {};

  for (const context of ruleset.requiredContexts) {
    const path = mapping[context];
    if (path === undefined) {
      findings.push({
        rule: "ci/unmapped-required-context",
        severity: "warning",
        message: `Required context "${context}" has no declared workflow mapping -- ci/both-triggers and ci/trigger-path-filter could not be evaluated for it.`,
        path: context,
      });
      continue;
    }
    const workflow = byPath.get(path);
    if (!workflow) {
      findings.push({
        rule: "ci/unmapped-required-context",
        severity: "warning",
        message: `Required context "${context}" is mapped to "${path}", which was not supplied among workflowFiles.`,
        path: context,
      });
      continue;
    }

    const on = workflow.doc.on;
    const triggers = triggerNames(on);
    if (!triggers.has("pull_request") || !triggers.has("merge_group")) {
      findings.push({
        rule: "ci/both-triggers",
        severity: "error",
        message: `Required context "${context}" (${path}) does not run on both pull_request and merge_group -- it stops gating merge_group under a merge queue.`,
        path,
      });
    }

    if (isPlainObject(on)) {
      for (const triggerName of ["pull_request", "push"] as const) {
        const triggerConfig = on[triggerName];
        if (isPlainObject(triggerConfig) && (triggerConfig.paths !== undefined || triggerConfig["paths-ignore"] !== undefined)) {
          findings.push({
            rule: "ci/trigger-path-filter-on-required-workflow",
            severity: "error",
            message: `Required context "${context}" (${path}) path-filters its ${triggerName} trigger -- a skipped required check reports as passing, not as absent.`,
            path,
          });
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 7: fan-in jobs use if: always() with an explicit results check
// ---------------------------------------------------------------------------

function checkFanIn(workflow: ParsedWorkflow): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const { name, job } of jobsOf(workflow.doc)) {
    const needs = asArray(job.needs).filter((n): n is string => typeof n === "string");
    if (needs.length < 2) continue;

    const ifCondition = typeof job.if === "string" ? job.if : "";
    const hasAlways = /always\(\s*\)/.test(ifCondition);

    const stepsText = stepsOf(job)
      .map((step) => (typeof step.run === "string" ? step.run : ""))
      .join("\n");
    const hasResultsCheck = needs.some((n) => stepsText.includes(`needs.${n}.result`)) || /\.result\b/.test(stepsText);

    if (!hasAlways) {
      findings.push({
        rule: "ci/fan-in-missing-always",
        severity: "error",
        message: `Job "${name}" in ${workflow.path} fans in ${needs.length} jobs (needs: ${needs.join(
          ", ",
        )}) without if: always() -- GitHub's implicit needs-gate skips it the moment one dependency fails, and a skipped required check reports as passing.`,
        path: `${workflow.path}#${name}`,
      });
    } else if (!hasResultsCheck) {
      findings.push({
        rule: "ci/fan-in-missing-results-check",
        severity: "warning",
        message: `Job "${name}" in ${workflow.path} sets if: always() but no step appears to check needs.*.result explicitly -- always() alone does not fail the job when a dependency failed.`,
        path: `${workflow.path}#${name}`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 8: gate-naming grammar
// ---------------------------------------------------------------------------

function checkGateNaming(ruleset: CiConventionsRuleset): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const context of ruleset.requiredContexts) {
    for (const finding of validateGateName(context, ruleset.gateNameOptions)) {
      findings.push({
        rule: finding.rule,
        severity: finding.severity === "high" ? "error" : "warning",
        message: finding.message,
        path: context,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 9: runner label against visibility and tier
// ---------------------------------------------------------------------------

function checkRunnerLabels(
  workflows: readonly ParsedWorkflow[],
  declaration: CiConventionsDeclaration,
): CheckFinding[] {
  const findings: CheckFinding[] = [];
  if (!declaration.runnerConventions) {
    findings.push({
      rule: "ci/no-runner-conventions-declared",
      severity: "warning",
      message: "No runner conventions declared -- the runner-label rule could not be evaluated for any job.",
    });
    return findings;
  }

  for (const workflow of workflows) {
    for (const { name, job } of jobsOf(workflow.doc)) {
      const runsOn = job["runs-on"];
      if (typeof runsOn !== "string") continue; // matrix / array labels are out of this rule's scope
      const definition: JobDefinition = {
        workflow: declaration.repositoryIdentifier ?? "",
        job: name,
        label: runsOn,
        repoVisibility: declaration.visibility,
      };
      for (const result of validateRunnerLabel(definition, declaration.runnerConventions)) {
        if (result.state === "satisfied") continue;
        findings.push({
          rule: result.rule,
          severity: result.state === "violated" ? "error" : "warning",
          message: `${result.message} (${workflow.path}#${name})`,
          path: `${workflow.path}#${name}`,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 10: minimal artifact retention-days
// ---------------------------------------------------------------------------

function checkRetentionDays(workflow: ParsedWorkflow, ruleset: CiConventionsRuleset): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const { name, job } of jobsOf(workflow.doc)) {
    for (const step of stepsOf(job)) {
      const uses = step.uses;
      if (typeof uses !== "string" || !uses.startsWith("actions/upload-artifact")) continue;
      const withBlock = step.with;
      const retention = isPlainObject(withBlock) ? withBlock["retention-days"] : undefined;
      if (retention === undefined) {
        findings.push({
          rule: "ci/missing-retention-days",
          severity: "warning",
          message: `Job "${name}" in ${workflow.path} uploads an artifact with no retention-days -- it defaults to GitHub's 90-day retention.`,
          path: `${workflow.path}#${name}`,
        });
      } else if (typeof retention === "number" && retention > ruleset.maxRetentionDays) {
        findings.push({
          rule: "ci/retention-days-too-long",
          severity: "warning",
          message: `Job "${name}" in ${workflow.path} sets retention-days: ${retention}, above the declared ceiling of ${ruleset.maxRetentionDays}.`,
          path: `${workflow.path}#${name}`,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 11: projected minutes vs. free allowances and declared budget
// ---------------------------------------------------------------------------

function checkProjectedMinutes(
  declaration: CiConventionsDeclaration,
  pricing: RunnerPricingData | undefined,
): { findings: CheckFinding[]; metric?: CheckMetric } {
  if (declaration.visibility !== "private" || declaration.runHistoryMinutes === undefined || !pricing) {
    return { findings: [] };
  }

  const plan = declaration.plan ?? "free";
  const freeAllowance =
    pricing.githubHosted.privateRepos.freeMinutesAllowance[plan] + pricing.blacksmith.freeMinutesAllowance.allPlans;
  const projected = declaration.runHistoryMinutes;
  const metric: CheckMetric = { name: "projectedMonthlyMinutes", value: projected, direction: "decrease" };

  const findings: CheckFinding[] = [];
  if (projected > freeAllowance) {
    findings.push({
      rule: "ci/projected-minutes-over-free-allowance",
      severity: "warning",
      message: `Projected monthly minutes (${projected}) exceed the free allowance for the ${plan} plan plus Blacksmith's free tier (${freeAllowance}, as of ${pricing.asOf}).`,
    });
  }
  if (declaration.monthlyMinutesBudget !== undefined && projected > declaration.monthlyMinutesBudget) {
    findings.push({
      rule: "ci/projected-minutes-over-budget",
      severity: "warning",
      message: `Projected monthly minutes (${projected}) exceed the declared monthly budget (${declaration.monthlyMinutesBudget}).`,
    });
  }
  return { findings, metric };
}

// ---------------------------------------------------------------------------
// Rule 12: weekly Sunday `@clossys/*` adoption convention for consuming
// repositories (issue #1187/#1259's cadence rule)
// ---------------------------------------------------------------------------

function checkWeeklyAdoption(
  ruleset: CiConventionsRuleset,
  declaration: CiConventionsDeclaration,
): CheckFinding[] {
  const weeklyAdoption = declaration.weeklyAdoption;
  if (!weeklyAdoption || !weeklyAdoption.applies) return [];

  const requiredContexts = weeklyAdoption.adoptionPrRequiredContexts ?? ruleset.requiredContexts;
  const findings: CheckFinding[] = [];
  for (const result of evaluateWeeklyAdoption(weeklyAdoption, requiredContexts)) {
    if (result.state === "satisfied") continue;
    findings.push({ rule: result.rule, severity: "error", message: result.message });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

function applyExceptions(
  findings: readonly CheckFinding[],
  exceptions: readonly JustifiedException[] | undefined,
): CheckFinding[] {
  if (!exceptions || exceptions.length === 0) return [...findings];
  return findings.filter((finding) => {
    return !exceptions.some((exception) => {
      if (exception.rule !== finding.rule) return false;
      if (exception.scope === undefined) return true;
      return finding.path !== undefined && finding.path.includes(exception.scope);
    });
  });
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluates `workflowFiles` against `ruleset` and `declaration`, and returns
 * the shared check-output envelope. Never throws on a malformed workflow
 * file -- an unparsable file becomes an `ci/unparsable-workflow` finding
 * rather than an exception, so one bad file does not stop every other rule
 * from being evaluated against the rest.
 */
export function evaluateCiConventions(input: EvaluateCiConventionsInput): CheckOutputEnvelope {
  const { workflowFiles, ruleset, declaration, pricing, packageVersion } = input;

  const { parsed, findings: parseFindings } = parseWorkflows(workflowFiles);
  const byPath = new Map(parsed.map((w) => [w.path, w] as const));

  const findings: CheckFinding[] = [...parseFindings];
  for (const workflow of parsed) {
    findings.push(...checkCancelInProgress(workflow, ruleset, declaration));
    findings.push(...checkTimeoutMinutes(workflow));
    findings.push(...checkShaPinning(workflow));
    findings.push(...checkTopLevelPermissions(workflow));
    findings.push(...checkFanIn(workflow));
    findings.push(...checkRetentionDays(workflow, ruleset));
  }
  findings.push(...checkRequiredContextTriggers(ruleset, declaration, byPath));
  findings.push(...checkGateNaming(ruleset));
  findings.push(...checkRunnerLabels(parsed, declaration));
  findings.push(...checkWeeklyAdoption(ruleset, declaration));

  const { findings: minutesFindings, metric } = checkProjectedMinutes(declaration, pricing);
  findings.push(...minutesFindings);

  const finalFindings = applyExceptions(findings, declaration.justifiedExceptions);

  const evaluatedNothing = workflowFiles.length === 0;
  const errorCount = finalFindings.filter((f) => f.severity === "error").length;

  let verdict: CiConventionsVerdict;
  let summary: string;
  let nextAction: string | undefined;

  if (evaluatedNothing) {
    verdict = "indeterminate";
    summary = "No workflow files were supplied, so no CI convention could be evaluated.";
    nextAction = "Supply at least one workflow file's contents to ci-conventions-check.";
  } else if (errorCount > 0) {
    verdict = "violated";
    summary = `${errorCount} of ${finalFindings.length} finding(s) are error-severity CI convention gaps across ${workflowFiles.length} workflow file(s).`;
    nextAction = `Fix the ${errorCount} error-severity finding(s), starting with "${finalFindings.find((f) => f.severity === "error")?.rule}".`;
  } else {
    verdict = "satisfied";
    summary =
      finalFindings.length > 0
        ? `All ${workflowFiles.length} workflow file(s) satisfy every checked CI convention, with ${finalFindings.length} advisory warning(s).`
        : `All ${workflowFiles.length} workflow file(s) satisfy every checked CI convention.`;
  }

  const envelope: CheckOutputEnvelope = {
    package: PACKAGE_NAME,
    version: packageVersion,
    verdict,
    summary,
    findings: finalFindings,
    ...(metric ? { metric } : {}),
    ...(nextAction ? { nextAction } : {}),
  };
  return envelope;
}
