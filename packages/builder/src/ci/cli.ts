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
 */

import { verifyToolchain, TOOLCHAIN_VERIFY_INPUTS_VERSION } from "./toolchain-cli.js";
import type { ToolchainVerifyInputs, ToolchainVerifyReport } from "./toolchain-cli.js";
import { MINIMUM_SAFE_VERSION } from "./version.js";

export const USAGE = `Usage: builder-verify-toolchain --inputs <path> [options]

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
