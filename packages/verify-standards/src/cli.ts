/**
 * `verify-standards` — the executable a consuming repository's own thin
 * workflow invokes.
 *
 * Presentation and argument handling only. Every decision is made by
 * `verifyStandards` and the four pure checks beneath it; this file parses
 * argv, reads one caller-named file through an injected port, renders a
 * report, and picks an exit code.
 *
 * Exit codes — this is the contract a consumer's CI depends on, and it is
 * the same one every other gate CLI in this repository already publishes:
 *
 *   0 — every selected check evaluated and was satisfied.
 *   1 — every selected check evaluated and at least one found a real problem.
 *   2 — at least one check could not evaluate, OR this build is below the
 *       minimum safe version, OR the arguments themselves were unusable.
 *       Kept strictly distinct from 1: "could not run" is not a flavour of
 *       "ran and failed", and a gate that reports clean after failing to run
 *       is worse than no gate at all.
 *
 * There is no flag that turns a `2` into a `0`. Whether a `2` blocks a merge
 * is a repository's own branch-protection decision, made in that repository;
 * it is deliberately not a knob here, because a knob here would launder one
 * consumer's exception into every consumer at once.
 *
 * SYNCHRONOUS ON PURPOSE
 * -----------------------
 * `main` returns a number, not a promise, and does no async work at all. An
 * earlier attempt at this gate assigned an un-awaited async `main()` to
 * `process.exitCode`, which is a `Promise` — always truthy, never a number —
 * so the process exited `0` no matter what the gate found, and the top-level
 * `try/catch` could not see a rejection either. The gate was fail-open at its
 * outermost layer, and nothing about its inner logic could have saved it.
 * Keeping every collection step outside this package is what makes a
 * synchronous entry point possible, and a synchronous entry point is what
 * makes that whole class of bug unreachable.
 */

import { verifyStandards, VERIFY_STANDARDS_INPUTS_VERSION } from "./verify.js";
import type { VerifyStandardsInputs, VerifyStandardsReport } from "./verify.js";
import { MINIMUM_SAFE_VERSION } from "./version.js";
import { STANDARDS_CHECKS } from "./types.js";
import type { StandardsCheckName } from "./types.js";

export const USAGE = `Usage: verify-standards --inputs <path> [options]

  --inputs <path>            Required. A JSON document (schemaVersion ${VERIFY_STANDARDS_INPUTS_VERSION}) carrying the
                             observations each check evaluates. The calling workflow assembles it;
                             this command performs no collection of its own.
  --checks <a,b,c>           Which checks to run. Defaults to all of: ${STANDARDS_CHECKS.join(", ")}.
                             Selecting none exits 2 — an empty run is not a passing run.
  --minimum-version <v>      Hold this build to a floor higher than its own compiled one
                             (${MINIMUM_SAFE_VERSION}). A lower value is ignored, never applied.
  --declared-range <range>   The range the calling repository declared for this package. Checked
                             against the minimum safe version, so a caller whose range still admits
                             a pre-floor build is told so before its next lockfile refresh.
  --format <text|json>       Output format. Defaults to text.
  --help                     Print this message and exit 0.

Exit codes: 0 = satisfied, 1 = violated, 2 = could not evaluate (including a stale build or bad input).
`;

/** Everything this CLI touches outside itself. Injected so no test needs a filesystem. */
export interface CliPort {
  /** Reads a text file. Throws for any failure; the caller turns that into exit 2. */
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
  readonly checks: readonly StandardsCheckName[];
  readonly minimumVersion?: string;
  readonly declaredRange?: string;
  readonly format: "text" | "json";
  readonly help: boolean;
}

function isCheckName(value: string): value is StandardsCheckName {
  return (STANDARDS_CHECKS as readonly string[]).includes(value);
}

/** Parses argv. Exported so its edge cases can be tested without a process. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let inputsPath: string | undefined;
  let checks: readonly StandardsCheckName[] = STANDARDS_CHECKS;
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
      case "--checks": {
        const value = argv[++index];
        if (value === undefined) throw new CliInputError("--checks requires a value");
        const names = value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry !== "");
        // An unknown check name is rejected rather than ignored. Silently
        // dropping a misspelled name would run fewer checks than the caller
        // asked for and still report success for the ones that did run —
        // which is how a typo becomes a gate nobody notices is gone.
        for (const name of names) {
          if (!isCheckName(name)) {
            throw new CliInputError(`unknown check "${name}" — known checks are ${STANDARDS_CHECKS.join(", ")}`);
          }
        }
        checks = names as readonly StandardsCheckName[];
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
          arg.startsWith("-")
            ? `unknown flag "${arg}"`
            : `unexpected argument "${arg}" — every input to this command is named`,
        );
    }
  }

  return { inputsPath, checks, minimumVersion, declaredRange, format, help };
}

/** Escapes a cell so a message containing a pipe cannot break the table it is rendered into. */
function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function verdictLabel(report: VerifyStandardsReport["rows"][number]): string {
  switch (report.result.verdict) {
    case "satisfied":
      return "satisfied";
    case "violated":
      return "violated";
    default:
      return `indeterminate (${report.result.reason})`;
  }
}

function rowDetail(report: VerifyStandardsReport["rows"][number]): string {
  const parts: string[] = [];
  if (report.result.verdict === "violated") {
    parts.push(...report.result.findings.map((finding) => `${finding.rule} (${finding.path}): ${finding.message}`));
  } else if (report.result.verdict === "indeterminate" && report.result.detail !== undefined) {
    parts.push(report.result.detail);
  } else if (report.result.verdict === "satisfied") {
    parts.push(`${report.result.evaluated} evaluated`);
  }
  if (report.note !== undefined) parts.push(report.note);
  return parts.join(" — ");
}

/** Renders the report as a table a CI job summary can display verbatim. */
export function renderReport(report: VerifyStandardsReport): string {
  const lines = ["## verify-standards", "", "| row | verdict | detail |", "| --- | --- | --- |"];
  for (const row of report.rows) {
    lines.push(`| ${cell(row.row)} | ${cell(verdictLabel(row))} | ${cell(rowDetail(row))} |`);
  }
  lines.push("", `Overall: ${report.overall.verdict.toUpperCase()} (exit ${report.exitCode})`);
  if (report.overall.verdict === "indeterminate") {
    lines.push(
      "",
      "An indeterminate result is a failure, not a warning. Something could not be evaluated, so nothing about it " +
        "has been established — see the row above that names the reason.",
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Runs the command. Returns the exit code rather than setting it, so a test
 * can assert on it directly and so nothing here can exit a host process that
 * only wanted to call the CLI as a function.
 */
export function main(argv: readonly string[], port: CliPort): 0 | 1 | 2 {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    port.writeErr(`verify-standards: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }

  if (args.help) {
    port.writeOut(USAGE);
    return 0;
  }

  if (args.inputsPath === undefined) {
    port.writeErr(`verify-standards: --inputs is required\n\n${USAGE}`);
    return 2;
  }

  // An unreadable or unparseable inputs file is exit 2 and never anything
  // else: the run did not happen, so it did not pass and it did not fail.
  let inputs: VerifyStandardsInputs;
  try {
    inputs = JSON.parse(port.readTextFile(args.inputsPath)) as VerifyStandardsInputs;
  } catch (error) {
    port.writeErr(
      `verify-standards: could not read the inputs document at ${args.inputsPath}: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  // Every check is written to turn a data problem into a verdict rather
  // than an exception, and each validates its own inputs to keep that true.
  // This catch is the backstop for the case where one of them is wrong.
  //
  // It is here because of where an escaping throw would land, not because
  // one is expected: an uncaught exception ends a Node process on status
  // `1`, and `1` is this contract's code for "ran, and found a real
  // problem." A crash would therefore be reported to a consumer's CI as a
  // finding about their repository, with no report and no named reason. `2`
  // is the honest answer for a run that did not complete — and this catch
  // only ever produces a `2`, so it can never turn a verdict into a pass.
  let report: VerifyStandardsReport;
  try {
    report = verifyStandards(inputs, {
      selectedChecks: args.checks,
      installedVersion: port.resolveOwnVersion(),
      ...(args.minimumVersion === undefined ? {} : { minimumVersion: args.minimumVersion }),
      ...(args.declaredRange === undefined ? {} : { declaredRange: args.declaredRange }),
    });
  } catch (error) {
    port.writeErr(
      `verify-standards: the run did not complete, so nothing about this repository has been established: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  port.writeOut(args.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report));
  return report.exitCode;
}
