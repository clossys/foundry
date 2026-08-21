/**
 * `builder-verify-toolchain` — the executable a consuming repository's own
 * thin workflow invokes. This is #257's Option C, concretely shipped: an
 * importable npm package with a CLI, not a cross-repository reusable
 * workflow reference. See `documents/caller-workflow.md` for the thin
 * workflow this CLI is meant to sit inside, and for why that shape — not a
 * `uses: <owner>/<repo>/.github/workflows/...@<ref>` — is the one this
 * account family's own cross-account boundary rule permits.
 *
 * Exit codes — the same contract `@vespeneventures/verify-standards` already
 * publishes, reused rather than reinvented:
 *
 *   0 — every row evaluated and was verified.
 *   1 — every row evaluated and at least one drifted.
 *   2 — at least one row could not be evaluated, OR this build is below the
 *       minimum safe version, OR the arguments themselves were unusable.
 *       Kept strictly distinct from 1: "could not run" is not a flavour of
 *       "ran and found drift."
 *
 * There is no flag that turns a `2` into a `0`. Whether a `2` blocks a merge
 * is a repository's own branch-protection decision, made in that repository.
 *
 * SYNCHRONOUS ON PURPOSE — see `@vespeneventures/verify-standards`'s own
 * `cli.ts` header for the full account of why an async `main()` assigned to
 * `process.exitCode` is a real, already-shipped defect class: `main` here
 * returns a number, not a promise, and does no async work at all.
 *
 * THREE SUBCOMMANDS, ADDED FOR #377
 * ------------------------------------
 * `aggregate-observations`, `check-observation-freshness`, and
 * `deployment-health` wire `aggregateObservations`, `checkObservationAggregate
 * Freshness` (`../observation-aggregate.ts`), and `evaluateDeploymentHealth`
 * (`../deployment/health.ts`) — this package's own gate-shaped exports that
 * had zero CLI path anywhere, the exact defect #377 names. Extending THIS
 * existing bin, rather than shipping a third one, follows the precedent
 * already set in this repository for the identical shape of fix
 * (`ledger-check append-only`, `copy-check locale-coverage`): one bin, one
 * more `argv[0]` value.
 *
 * Dispatch happens on the literal `argv[0]` token, checked in `main` BEFORE
 * the pre-existing no-subcommand `parseArgs` path runs — never on
 * `basename(process.argv[1])`. This repository invokes every gate by its
 * compiled path (`node packages/builder/dist/ci/bin.js`), so a dispatch keyed
 * off the invoked file's own name would always see `bin.js` — the SAME
 * value for every subcommand and the no-subcommand path alike — and could
 * never actually distinguish one command from another. This is the exact
 * defect #377's own text warns already shipped once in this effort. See
 * `cli.test.ts`'s direct-path reachability suite, which spawns the real
 * compiled `dist/ci/bin.js` and asserts real exit codes for all four
 * commands, including the pre-existing no-subcommand path unchanged.
 */

import { gateResultToExitCode } from "@vespeneventures/controller/gates";
import type { GateResult } from "@vespeneventures/controller/gates";
import type { DeploymentHealthSummary, DeploymentObservation } from "../deployment/types.js";
import { evaluateDeploymentHealth } from "../deployment/health.js";
import type { AggregateObservationsInput, AggregateObservationsResult, CheckObservationAggregateFreshnessInput, ObservationAggregateResultIndeterminateReason } from "../observation-aggregate.js";
import { aggregateObservations, checkObservationAggregateFreshness } from "../observation-aggregate.js";
import { verifyToolchain, TOOLCHAIN_VERIFY_INPUTS_VERSION } from "./toolchain-cli.js";
import type { ToolchainVerifyInputs, ToolchainVerifyReport } from "./toolchain-cli.js";
import { MINIMUM_SAFE_VERSION } from "./version.js";

export const USAGE = `Usage: builder-verify-toolchain --inputs <path> [options]
   or: builder-verify-toolchain aggregate-observations --inputs <path> [options]
   or: builder-verify-toolchain check-observation-freshness --inputs <path> [options]
   or: builder-verify-toolchain deployment-health --inputs <path> [options]

  --inputs <path>            Required. A JSON document (schemaVersion ${TOOLCHAIN_VERIFY_INPUTS_VERSION}) carrying the
                             declared toolchain and the observed live state. The calling workflow
                             assembles it; this command performs no collection of its own.
  --minimum-version <v>      Hold this build to a floor higher than its own compiled one
                             (${MINIMUM_SAFE_VERSION}). A lower value is ignored, never applied.
  --declared-range <range>   The range the calling repository declared for this package. Checked
                             against the minimum safe version, so a caller whose range still admits
                             a pre-floor build is told so before its next lockfile refresh.
  --format <text|json>       Output format. Defaults to text.
  --help                     Print this message and exit 0.

Exit codes: 0 = verified, 1 = drifted, 2 = could not verify (including a stale build or bad input).

Run "builder-verify-toolchain aggregate-observations --help", "builder-verify-toolchain check-observation-freshness --help",
or "builder-verify-toolchain deployment-health --help" for the other three subcommands' own usage.
`;

const AGGREGATE_OBSERVATIONS_USAGE = `Usage: builder-verify-toolchain aggregate-observations --inputs <path> [options]

  --inputs <path>   Required. A JSON document shaped exactly like AggregateObservationsInput:
                    { expectedRepositories: string[], bundles: unknown[], now: string (ISO 8601),
                      staleAfterMs: number, maxResultAgeMs: number }. bundles is already-fetched
                    data -- this command performs no fetching of its own; see
                    "@vespeneventures/builder"'s aggregateObservations doc comment.
  --format <text|json>   Output format. Defaults to text.
  --help                 Print this message and exit 0.

Folds every bundle into one plane-level report -- an unobserved, duplicate, stale, or malformed
repository is reported "indeterminate" with a named reason, never silently dropped and never
folded into a false "satisfied".

Exit codes: 0 = every expected repository was cleanly, freshly, and uniquely observed and satisfied;
1 = at least one repository's own gates were violated; 2 = could not evaluate (bad input, or at
least one repository could not be classified as satisfied/violated -- unobserved, duplicated,
stale, or schema-invalid).
`;

const CHECK_OBSERVATION_FRESHNESS_USAGE = `Usage: builder-verify-toolchain check-observation-freshness --inputs <path> [options]

  --inputs <path>   Required. A JSON document shaped exactly like CheckObservationAggregateFreshness
                    Input: { computedAt: string (ISO 8601), maxResultAgeMs: number, now: string
                    (ISO 8601) }. computedAt and maxResultAgeMs are typically read back from a
                    previously PERSISTED aggregate-observations result; now is the reader's own
                    clock, at read time.
  --format <text|json>   Output format. Defaults to text.
  --help                 Print this message and exit 0.

Answers the question aggregate-observations cannot ask of its own output: is a previously computed,
persisted result still recent enough to be presented as current -- see checkObservationAggregate
Freshness's own doc comment ("@vespeneventures/builder"'s observation-aggregate.ts).

Exit codes: 0 = the result is within its declared maxResultAgeMs; 1 = never produced by this
command -- staleness has no "violated" state, only "still current" or "could not vouch for"; 2 =
could not evaluate (bad input) or the result is too old to vouch for (stale-aggregate-result) or its
own timestamp could not be established (unusable-timestamp).
`;

const DEPLOYMENT_HEALTH_USAGE = `Usage: builder-verify-toolchain deployment-health --inputs <path> [options]

  --inputs <path>   Required. A JSON document: { observations: DeploymentObservation[] }, where each
                    DeploymentObservation is { surfaceId: string, status: "healthy" | "degraded" |
                    "unhealthy" | "unknown" }. This command performs no inspection of its own --
                    observations are supplied by the caller, typically read back from the
                    "@vespeneventures/builder/deployment" provider adapters.
  --format <text|json>   Output format. Defaults to text.
  --help                 Print this message and exit 0.

Folds every surface's own status into one DeploymentHealthSummary -- see evaluateDeploymentHealth's
own doc comment ("@vespeneventures/builder/deployment"'s health.ts).

Exit codes: 0 = every recognized observation is healthy (no degraded, unhealthy, or unknown surface);
1 = at least one surface is degraded or unhealthy -- a real finding; 2 = could not evaluate (bad
input) or at least one surface's status could not be recognized, including "no observations at all".
`;

/** Everything this CLI touches outside itself. Injected so no test needs a filesystem. */
export interface CliPort {
  readTextFile(path: string): string;
  writeOut(text: string): void;
  writeErr(text: string): void;
  /** This build's own version. `undefined` is a real answer and produces exit 2. */
  resolveOwnVersion(): string | undefined;
}

/** Thrown for anything wrong with the arguments themselves. Always exit 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  readonly inputsPath?: string;
  readonly minimumVersion?: string;
  readonly declaredRange?: string;
  readonly format: "text" | "json";
  readonly help: boolean;
}

/** Parses argv. Exported so its edge cases can be tested without a process. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let inputsPath: string | undefined;
  let minimumVersion: string | undefined;
  let declaredRange: string | undefined;
  let format: "text" | "json" = "text";
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--inputs": {
        const value = argv[++index];
        if (value === undefined) throw new CliInputError("--inputs requires a value");
        inputsPath = value;
        break;
      }
      case "--minimum-version": {
        const value = argv[++index];
        if (value === undefined) throw new CliInputError("--minimum-version requires a value");
        minimumVersion = value;
        break;
      }
      case "--declared-range": {
        const value = argv[++index];
        if (value === undefined) throw new CliInputError("--declared-range requires a value");
        declaredRange = value;
        break;
      }
      case "--format": {
        const value = argv[++index];
        if (value !== "text" && value !== "json") {
          throw new CliInputError(`--format must be "text" or "json", got ${JSON.stringify(value)}`);
        }
        format = value;
        break;
      }
      default:
        throw new CliInputError(
          arg.startsWith("-") ? `unknown flag "${arg}"` : `unexpected argument "${arg}" — every input to this command is named`,
        );
    }
  }

  return { inputsPath, minimumVersion, declaredRange, format, help };
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function verdictLabel(result: ToolchainVerifyReport["rows"][number]["result"]): string {
  switch (result.verdict) {
    case "satisfied":
      return "verified";
    case "violated":
      return "drifted";
    default:
      return `could-not-verify (${result.reason})`;
  }
}

function rowDetail(result: ToolchainVerifyReport["rows"][number]["result"]): string {
  if (result.verdict === "violated") {
    return result.findings.map((finding) => `${finding.kind} (${finding.subject}): ${finding.message}`).join(" — ");
  }
  if (result.verdict === "indeterminate") {
    return result.detail ?? result.reason;
  }
  return "agrees with live state";
}

/** Renders the report as a table a CI job summary can display verbatim. */
export function renderReport(report: ToolchainVerifyReport): string {
  const lines = ["## builder-verify-toolchain", "", "| row | verdict | detail |", "| --- | --- | --- |"];
  for (const row of report.rows) {
    lines.push(`| ${cell(row.row)} | ${cell(verdictLabel(row.result))} | ${cell(rowDetail(row.result))} |`);
  }
  const overallLabel = report.overall.verdict === "satisfied" ? "VERIFIED" : report.overall.verdict === "violated" ? "DRIFTED" : "COULD-NOT-VERIFY";
  lines.push("", `Overall: ${overallLabel} (exit ${report.exitCode})`);
  if (report.overall.verdict === "indeterminate") {
    lines.push(
      "",
      "A could-not-verify result is a failure, not a warning. Something could not be evaluated, so nothing about " +
        "it has been established — see the row above that names the reason. A green run elsewhere is not evidence " +
        "against this one.",
    );
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------
// aggregate-observations, check-observation-freshness, deployment-health —
// the three subcommands added for #377. See this file's top-of-file doc
// comment for why they live on this bin. Everything below is presentation
// and argv/JSON handling only, the same split `main()` already draws for
// `verifyToolchain` above: all real logic lives in `../observation-
// aggregate.ts` and `../deployment/health.ts`.
// ---------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface InputsFormatArgs {
  readonly inputsPath?: string;
  readonly format: "text" | "json";
  readonly help: boolean;
}

/** Shared argv parser for the three subcommands below: each takes only --inputs, --format, and --help. */
function parseInputsFormatArgs(argv: readonly string[]): InputsFormatArgs {
  let inputsPath: string | undefined;
  let format: "text" | "json" = "text";
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--inputs": {
        const value = argv[++index];
        if (value === undefined) throw new CliInputError("--inputs requires a value");
        inputsPath = value;
        break;
      }
      case "--format": {
        const value = argv[++index];
        if (value !== "text" && value !== "json") {
          throw new CliInputError(`--format must be "text" or "json", got ${JSON.stringify(value)}`);
        }
        format = value;
        break;
      }
      default:
        throw new CliInputError(
          arg.startsWith("-") ? `unknown flag "${arg}"` : `unexpected argument "${arg}" — every input to this command is named`,
        );
    }
  }

  return { inputsPath, format, help };
}

function readInputsDocument(commandLabel: string, usage: string, args: InputsFormatArgs, port: CliPort): { ok: true; value: unknown } | { ok: false; exitCode: 2 } {
  if (args.inputsPath === undefined) {
    port.writeErr(`builder-verify-toolchain ${commandLabel}: --inputs is required\n\n${usage}`);
    return { ok: false, exitCode: 2 };
  }
  try {
    return { ok: true, value: JSON.parse(port.readTextFile(args.inputsPath)) };
  } catch (error) {
    port.writeErr(
      `builder-verify-toolchain ${commandLabel}: could not read the inputs document at ${args.inputsPath}: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return { ok: false, exitCode: 2 };
  }
}

// --- aggregate-observations -------------------------------------------

function isValidAggregateObservationsInput(value: unknown): value is AggregateObservationsInput {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.expectedRepositories) || !value.expectedRepositories.every((entry) => typeof entry === "string")) return false;
  if (!Array.isArray(value.bundles)) return false;
  if (typeof value.now !== "string") return false;
  if (typeof value.staleAfterMs !== "number") return false;
  if (typeof value.maxResultAgeMs !== "number") return false;
  return true;
}

function renderAggregateObservationsReport(report: AggregateObservationsResult, exitCode: 0 | 1 | 2): string {
  const lines = ["## builder-verify-toolchain aggregate-observations", "", "| repository | verdict | detail |", "| --- | --- | --- |"];
  for (const status of report.repositories) {
    const { result } = status;
    const verdict = result.verdict === "satisfied" ? "satisfied" : result.verdict === "violated" ? "violated" : `indeterminate (${result.reason})`;
    const detail =
      result.verdict === "violated"
        ? result.findings.map((finding) => `${finding.rule}: ${finding.message}`).join(" — ")
        : result.verdict === "indeterminate"
          ? (result.detail ?? result.reason)
          : "observed and satisfied";
    lines.push(`| ${cell(status.repositoryId)} | ${cell(verdict)} | ${cell(detail)} |`);
  }
  const overallLabel = report.overall.verdict === "satisfied" ? "SATISFIED" : report.overall.verdict === "violated" ? "VIOLATED" : "INDETERMINATE";
  lines.push(
    "",
    `Overall: ${overallLabel} (exit ${exitCode})`,
    `expected ${report.expectedCount}, received ${report.receivedCount}, unattributed ${report.unattributedCount}, ` +
      `unobserved [${report.unobservedRepositories.join(", ")}], unexpected [${report.unexpectedRepositories.join(", ")}]`,
  );
  return `${lines.join("\n")}\n`;
}

function runAggregateObservations(argv: readonly string[], port: CliPort): 0 | 1 | 2 {
  let args: InputsFormatArgs;
  try {
    args = parseInputsFormatArgs(argv);
  } catch (error) {
    port.writeErr(`builder-verify-toolchain aggregate-observations: ${error instanceof Error ? error.message : String(error)}\n\n${AGGREGATE_OBSERVATIONS_USAGE}`);
    return 2;
  }
  if (args.help) {
    port.writeOut(AGGREGATE_OBSERVATIONS_USAGE);
    return 0;
  }

  const read = readInputsDocument("aggregate-observations", AGGREGATE_OBSERVATIONS_USAGE, args, port);
  if (!read.ok) return read.exitCode;

  if (!isValidAggregateObservationsInput(read.value)) {
    port.writeErr(
      `builder-verify-toolchain aggregate-observations: the inputs document at ${args.inputsPath} does not match ` +
        "AggregateObservationsInput (expectedRepositories: string[], bundles: unknown[], now: string, " +
        "staleAfterMs: number, maxResultAgeMs: number).\n",
    );
    return 2;
  }

  let report: AggregateObservationsResult;
  try {
    report = aggregateObservations(read.value);
  } catch (error) {
    port.writeErr(
      `builder-verify-toolchain aggregate-observations: the run did not complete, so nothing has been established: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  const exitCode = gateResultToExitCode(report.overall);
  port.writeOut(args.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderAggregateObservationsReport(report, exitCode));
  return exitCode;
}

// --- check-observation-freshness ----------------------------------------

function isValidCheckObservationAggregateFreshnessInput(value: unknown): value is CheckObservationAggregateFreshnessInput {
  return isRecord(value) && typeof value.computedAt === "string" && typeof value.maxResultAgeMs === "number" && typeof value.now === "string";
}

function renderCheckObservationFreshnessReport(result: GateResult<never, ObservationAggregateResultIndeterminateReason>, exitCode: 0 | 1 | 2): string {
  const label = result.verdict === "satisfied" ? "CURRENT" : "INDETERMINATE";
  const detail = result.verdict === "indeterminate" ? (result.detail ?? result.reason) : "within its declared maxResultAgeMs";
  return `## builder-verify-toolchain check-observation-freshness\n\n${label}: ${detail} (exit ${exitCode})\n`;
}

function runCheckObservationFreshness(argv: readonly string[], port: CliPort): 0 | 1 | 2 {
  let args: InputsFormatArgs;
  try {
    args = parseInputsFormatArgs(argv);
  } catch (error) {
    port.writeErr(`builder-verify-toolchain check-observation-freshness: ${error instanceof Error ? error.message : String(error)}\n\n${CHECK_OBSERVATION_FRESHNESS_USAGE}`);
    return 2;
  }
  if (args.help) {
    port.writeOut(CHECK_OBSERVATION_FRESHNESS_USAGE);
    return 0;
  }

  const read = readInputsDocument("check-observation-freshness", CHECK_OBSERVATION_FRESHNESS_USAGE, args, port);
  if (!read.ok) return read.exitCode;

  if (!isValidCheckObservationAggregateFreshnessInput(read.value)) {
    port.writeErr(
      `builder-verify-toolchain check-observation-freshness: the inputs document at ${args.inputsPath} does not match ` +
        "CheckObservationAggregateFreshnessInput (computedAt: string, maxResultAgeMs: number, now: string).\n",
    );
    return 2;
  }

  let result: GateResult<never, ObservationAggregateResultIndeterminateReason>;
  try {
    result = checkObservationAggregateFreshness(read.value);
  } catch (error) {
    port.writeErr(
      `builder-verify-toolchain check-observation-freshness: the run did not complete, so nothing has been established: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  const exitCode = gateResultToExitCode(result);
  port.writeOut(args.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderCheckObservationFreshnessReport(result, exitCode));
  return exitCode;
}

// --- deployment-health ----------------------------------------------------

const DEPLOYMENT_HEALTH_STATUSES = new Set(["healthy", "degraded", "unhealthy", "unknown"]);

interface DeploymentHealthInputs {
  readonly observations: readonly DeploymentObservation[];
}

function isValidDeploymentObservation(value: unknown): value is DeploymentObservation {
  return isRecord(value) && typeof value.surfaceId === "string" && typeof value.status === "string" && DEPLOYMENT_HEALTH_STATUSES.has(value.status);
}

function isValidDeploymentHealthInputs(value: unknown): value is DeploymentHealthInputs {
  return isRecord(value) && Array.isArray(value.observations) && value.observations.every(isValidDeploymentObservation);
}

/** The fleet 0/1/2 ternary, applied to DeploymentHealthStatus: healthy is satisfied, degraded/unhealthy is a real finding, unknown (including "nothing recognized at all") is indeterminate. */
function deploymentHealthExitCode(status: DeploymentHealthSummary["status"]): 0 | 1 | 2 {
  if (status === "healthy") return 0;
  if (status === "degraded" || status === "unhealthy") return 1;
  return 2;
}

function renderDeploymentHealthReport(summary: DeploymentHealthSummary, exitCode: 0 | 1 | 2): string {
  const label = summary.status === "healthy" ? "HEALTHY" : summary.status === "degraded" ? "DEGRADED" : summary.status === "unhealthy" ? "UNHEALTHY" : "UNKNOWN";
  return (
    "## builder-verify-toolchain deployment-health\n\n" +
    `Overall: ${label} (exit ${exitCode})\n` +
    `healthy ${summary.healthy}, degraded ${summary.degraded}, unhealthy ${summary.unhealthy}, unknown ${summary.unknown}\n`
  );
}

function runDeploymentHealth(argv: readonly string[], port: CliPort): 0 | 1 | 2 {
  let args: InputsFormatArgs;
  try {
    args = parseInputsFormatArgs(argv);
  } catch (error) {
    port.writeErr(`builder-verify-toolchain deployment-health: ${error instanceof Error ? error.message : String(error)}\n\n${DEPLOYMENT_HEALTH_USAGE}`);
    return 2;
  }
  if (args.help) {
    port.writeOut(DEPLOYMENT_HEALTH_USAGE);
    return 0;
  }

  const read = readInputsDocument("deployment-health", DEPLOYMENT_HEALTH_USAGE, args, port);
  if (!read.ok) return read.exitCode;

  if (!isValidDeploymentHealthInputs(read.value)) {
    port.writeErr(
      `builder-verify-toolchain deployment-health: the inputs document at ${args.inputsPath} does not match ` +
        '{ observations: { surfaceId: string, status: "healthy" | "degraded" | "unhealthy" | "unknown" }[] }.\n',
    );
    return 2;
  }

  const summary = evaluateDeploymentHealth(read.value.observations);
  const exitCode = deploymentHealthExitCode(summary.status);
  port.writeOut(args.format === "json" ? `${JSON.stringify(summary, null, 2)}\n` : renderDeploymentHealthReport(summary, exitCode));
  return exitCode;
}

/**
 * Runs the command. Returns the exit code rather than setting it, so a test
 * can assert on it directly and so nothing here can exit a host process that
 * only wanted to call the CLI as a function.
 */
export function main(argv: readonly string[], port: CliPort): 0 | 1 | 2 {
  // Dispatch on the literal argv[0] token — never on basename(process.argv[1]),
  // which this repository's compiled-path invocation convention would always
  // see as "bin.js" (the same value for every subcommand here). See this
  // file's top-of-file doc comment.
  if (argv[0] === "aggregate-observations") return runAggregateObservations(argv.slice(1), port);
  if (argv[0] === "check-observation-freshness") return runCheckObservationFreshness(argv.slice(1), port);
  if (argv[0] === "deployment-health") return runDeploymentHealth(argv.slice(1), port);

  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    port.writeErr(`builder-verify-toolchain: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }

  if (args.help) {
    port.writeOut(USAGE);
    return 0;
  }

  if (args.inputsPath === undefined) {
    port.writeErr(`builder-verify-toolchain: --inputs is required\n\n${USAGE}`);
    return 2;
  }

  let inputs: ToolchainVerifyInputs;
  try {
    inputs = JSON.parse(port.readTextFile(args.inputsPath)) as ToolchainVerifyInputs;
  } catch (error) {
    port.writeErr(
      `builder-verify-toolchain: could not read the inputs document at ${args.inputsPath}: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  // Every check turns a data problem into a verdict rather than an
  // exception. This catch is the backstop for the case where one of them is
  // wrong — see `@vespeneventures/verify-standards`'s own `cli.ts` for why
  // this must only ever be able to produce a `2`, never accidentally read
  // as a `1` at the process boundary.
  let report: ToolchainVerifyReport;
  try {
    report = verifyToolchain(inputs, {
      installedVersion: port.resolveOwnVersion(),
      ...(args.minimumVersion === undefined ? {} : { minimumVersion: args.minimumVersion }),
      ...(args.declaredRange === undefined ? {} : { declaredRange: args.declaredRange }),
    });
  } catch (error) {
    port.writeErr(
      `builder-verify-toolchain: the run did not complete, so nothing has been established: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  port.writeOut(args.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report));
  return report.exitCode;
}
