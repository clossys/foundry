/**
 * `builder-verify-machine` — the CLI path issue #377 asks every gate to
 * ship: a library export with no invokable command is decorative. This is
 * the `verify` mode issue #393 asks for "at minimum": for every managed
 * skill destination, what it resolves to and whether that matches the
 * composed manifest, on the fleet 0/1/2 exit-code ternary
 * (`@vespeneventures/controller/gates`'s `gateResultToExitCode`).
 *
 * SYNCHRONOUS ON PURPOSE, same as `../ci/cli.ts`: `main` returns a number,
 * not a promise, so nothing here can leave `process.exitCode` unset on an
 * unhandled rejection. See that module's header for the fuller account.
 */

import { verifyMachine } from "./report.js";
import type { MachineVerifyInputs, MachineVerifyReport } from "./report.js";
import type { DiscoveryPort } from "./types.js";
import type { FileSystemPort } from "../types.js";

export const USAGE = `Usage: builder-verify-machine --inputs <path> [options]

  --inputs <path>   Required. A JSON document (schemaVersion 1) declaring \`home\`,
                     \`composedSkillsRoot\`, and optionally \`accountWorkspacesRoot\` /
                     \`thirdPartySkillsRoot\` / \`classOneDeclarationPath\` /
                     \`previousCompositionPath\`. The three roots/paths may instead come
                     from the BUILDER_MACHINE_WORKSPACES_ROOT /
                     BUILDER_MACHINE_THIRD_PARTY_SKILLS_ROOT /
                     BUILDER_MACHINE_LAYER_DECLARATION_PATH environment variables; an
                     explicit inputs field always wins. \`previousCompositionPath\` has
                     no environment variable — it names a caller-persisted prior run's
                     composed operations, so it is only ever supplied explicitly.
  --format <text|json>   Output format. Defaults to text.
  --help                 Print this message and exit 0.

Exit codes: 0 = every managed destination resolves as composed, 1 = at least one
destination or source disagreed, 2 = could not verify (including a source that
could not be read, or bad input).
`;

/** Everything this CLI touches outside itself, injected so no test needs a real machine. */
export interface CliPort {
  readTextFile(path: string): string;
  writeOut(text: string): void;
  writeErr(text: string): void;
  discovery: DiscoveryPort;
  filesystem: FileSystemPort;
  env: Readonly<Record<string, string | undefined>>;
}

/** Thrown for anything wrong with the arguments themselves. Always exit 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  readonly inputsPath?: string;
  readonly format: "text" | "json";
  readonly help: boolean;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
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

function cell(value: string): string {
  let escaped = "";
  let previousWasCarriageReturn = false;
  for (const character of value) {
    if (character === "\r") {
      escaped += " ";
      previousWasCarriageReturn = true;
    } else if (character === "\n") {
      if (!previousWasCarriageReturn) escaped += " ";
      previousWasCarriageReturn = false;
    } else {
      previousWasCarriageReturn = false;
      escaped += character === "\\" ? "\\\\" : character === "|" ? "\\|" : character;
    }
  }
  return escaped;
}

function verdictLabel(result: MachineVerifyReport["rows"][number]["result"]): string {
  switch (result.verdict) {
    case "satisfied":
      return "resolved";
    case "violated":
      return "disagreed";
    default:
      return `could-not-verify (${result.reason})`;
  }
}

function rowDetail(result: MachineVerifyReport["rows"][number]["result"]): string {
  if (result.verdict === "violated") {
    return result.findings.map((finding) => `${finding.rule}: ${finding.message}`).join(" — ");
  }
  if (result.verdict === "indeterminate") {
    return result.detail ?? result.reason;
  }
  return `resolves as composed (${result.evaluated} evaluated)`;
}

/** Renders the report as a table a CI job summary can display verbatim. */
export function renderReport(report: MachineVerifyReport): string {
  const lines = ["## builder-verify-machine", "", "| destination / row | verdict | detail |", "| --- | --- | --- |"];
  for (const row of report.rows) {
    lines.push(`| ${cell(row.row)} | ${cell(verdictLabel(row.result))} | ${cell(rowDetail(row.result))} |`);
  }
  const overallLabel =
    report.overall.verdict === "satisfied" ? "SATISFIED" : report.overall.verdict === "violated" ? "VIOLATED" : "INDETERMINATE";
  lines.push("", `Overall: ${overallLabel} (exit ${report.exitCode})`);
  if (report.overall.verdict === "indeterminate") {
    lines.push(
      "",
      "An indeterminate result is a failure, not a warning: at least one source could not be read, so nothing about " +
        "the composed machine has been established. See the row above naming the reason — a green run elsewhere is " +
        "not evidence against this one.",
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
    port.writeErr(`builder-verify-machine: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }

  if (args.help) {
    port.writeOut(USAGE);
    return 0;
  }

  if (args.inputsPath === undefined) {
    port.writeErr(`builder-verify-machine: --inputs is required\n\n${USAGE}`);
    return 2;
  }

  let inputs: MachineVerifyInputs;
  try {
    inputs = JSON.parse(port.readTextFile(args.inputsPath)) as MachineVerifyInputs;
  } catch (error) {
    port.writeErr(
      `builder-verify-machine: could not read the inputs document at ${args.inputsPath}: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  let report: MachineVerifyReport;
  try {
    report = verifyMachine(port.discovery, port.filesystem, inputs, { env: port.env });
  } catch (error) {
    port.writeErr(
      `builder-verify-machine: the run did not complete, so nothing has been established: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  port.writeOut(args.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report));
  return report.exitCode;
}
