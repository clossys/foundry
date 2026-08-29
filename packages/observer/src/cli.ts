/**
 * `observer-coverage-check` — the CLI for `gradeFleetCoverage` (`./coverage.ts`).
 * observer's FIRST bin: #377 calls a gate shipped as a library export with
 * no CLI path "decorative", and until this file existed that was exactly
 * this package's own status — `gradeFleetCoverage` was invocable only by
 * someone writing TypeScript against it directly.
 *
 * PORT-INJECTED, LIKE `@vespeneventures/builder`'s `ci/cli.ts` + `ci/bin.ts`
 * -----------------------------------------------------------------------------
 * Everything this file touches outside itself — reading the input file,
 * writing output — goes through `CliPort`, exactly the split
 * `@vespeneventures/builder`'s `ci/cli.ts`/`ci/bin.ts` already uses: `./bin.ts`
 * is the installed executable and supplies the real port (`node:fs`,
 * `process.stdout`/`stderr`); this file exports `main(argv, port)`, testable
 * with an in-memory port and no real filesystem. `main` returns the exit
 * code rather than setting `process.exitCode` itself, for the same reason —
 * a test can assert on it directly, and nothing here can exit a host process
 * that only wanted to call this as a function.
 *
 * WHAT THIS CLI DOES AND DOES NOT DO
 * -------------------------------------
 * This command reads ONE JSON "fleet coverage input" document (assembled by
 * its caller — see `FleetCoverageCliInput` below) and grades it. It never
 * fetches a repository's declaration file and never reads a manifest or
 * lockfile itself — `gradeFleetCoverage`'s own contract (`./coverage.ts`)
 * is that the installed inventory and each repository's raw declaration
 * payload are caller-supplied, and this CLI does not weaken that: the
 * caller's own script is expected to have already fetched each
 * repository's coverage-declaration file (see `./coverage-declaration.ts`'s
 * header for the "no credentials" transport this is designed for) and
 * already computed each repository's installed inventory (for example with
 * `@vespeneventures/integrator`'s `readInstalledInventory`, run in the
 * CALLER's own script — this package adds no dependency on that package to
 * do so) before this command ever runs. "Wiring a caller's inventory in at
 * the call site" means exactly this: the data arrives already materialized,
 * in the input file, never fetched by this file.
 *
 * Exit codes — this package's one gate ternary
 * (`fleetCoverageVerdictToExitCode`, `./coverage.ts`), applied here:
 *
 *   0 — every cell resolved, none unclassified, no contradiction.
 *   1 — every cell resolved, but at least one repository is BOTH installed
 *       AND declared absent for the same package (a stale or wrong
 *       declaration).
 *   2 — at least one cell is unclassified, OR the matrix was empty (#338:
 *       zero cells graded is never a clean pass), OR the input itself could
 *       not be read/parsed.
 *
 * There is no flag that turns a `2` into a `0`. Whether a `2` blocks a merge
 * is a repository's own branch-protection decision.
 */

import { fleetCoverageVerdictToExitCode, gradeFleetCoverage } from "./coverage.js";
import type { FleetCoverageInput, FleetCoverageReport, FleetInstalledInventory, FleetRepositoryCoverageInput } from "./coverage.js";

export const USAGE = `Usage: observer-coverage-check --input <path> [options]

  --input <path>   Required. A JSON document (see below) describing the fleet's package
                    catalog and every repository's own coverage declaration and installed
                    inventory. This command performs no collection of its own -- the caller
                    assembles this file.
  --format <text|json>   Output format. Defaults to text.
  --help                 Print this message and exit 0.

Input document shape:

  {
    "schemaVersion": 1,
    "packages": ["@scope/package-a", "@scope/package-b"],
    "repositories": [
      {
        "repository": "repo-id",
        "declaration": <the already-fetched body of this repository's own coverage-declaration
                         file, or omit entirely if none could be found>,
        "installed": { "packages": [{ "name": "@scope/package-a" }] }
                        (omit entirely if the installed inventory could not be read)
      }
    ]
  }

Exit codes: 0 = every cell resolved and clean, 1 = at least one repository is both installed
and declared absent for the same package, 2 = at least one cell is unclassified, the matrix
was empty, or the input could not be read.
`;

/** Everything this CLI touches outside itself. Injected so no test needs a filesystem. */
export interface CliPort {
  readTextFile(path: string): string;
  writeOut(text: string): void;
  writeErr(text: string): void;
}

/** Thrown for anything wrong with the arguments or the input document itself. Always exit 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  readonly inputPath: string | undefined;
  readonly format: "text" | "json";
  readonly help: boolean;
}

/** Parses argv. Exported so its edge cases can be tested without a process. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let inputPath: string | undefined;
  let format: "text" | "json" = "text";
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--input": {
        const value = argv[++index];
        if (value === undefined) throw new CliInputError("--input requires a value");
        inputPath = value;
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
          arg.startsWith("-") ? `unknown flag "${arg}"` : `unexpected argument "${arg}" -- every input to this command is named`,
        );
    }
  }

  return { inputPath, format, help };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates and narrows the CLI's own top-level input shape into
 * `FleetCoverageInput` (`./coverage.ts`) directly -- there is no separate
 * intermediate CLI-only input type: `FleetRepositoryCoverageInput`'s
 * `declaration`/`installed` fields are already REQUIRED keys typed to
 * permit an `undefined` value (`unknown` and `FleetInstalledInventory |
 * undefined` respectively), which is exactly what "declaration omitted" /
 * "installed omitted" in the JSON document means, and needs no optional-key
 * juggling under this package's `exactOptionalPropertyTypes`. Throws
 * `CliInputError` (exit 2) on anything wrong -- this is the CALLER'S input
 * to THIS command, so a shape defect here is a usage error, not a
 * gradeable fact about the fleet.
 */
function parseCliInput(raw: unknown): FleetCoverageInput {
  if (!isRecord(raw)) {
    throw new CliInputError("the input document must be a JSON object");
  }
  const packages = raw.packages;
  if (!Array.isArray(packages) || !packages.every((entry) => typeof entry === "string")) {
    throw new CliInputError('"packages" is required and must be an array of strings');
  }
  const repositories = raw.repositories;
  if (!Array.isArray(repositories)) {
    throw new CliInputError('"repositories" is required and must be an array');
  }
  const parsedRepositories: FleetRepositoryCoverageInput[] = repositories.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new CliInputError(`repositories[${index}] must be an object`);
    }
    const repository = entry.repository;
    if (typeof repository !== "string" || repository.trim() === "") {
      throw new CliInputError(`repositories[${index}].repository is required and must be a non-empty string`);
    }
    if (entry.installed !== undefined && !isRecord(entry.installed)) {
      throw new CliInputError(`repositories[${index}].installed, when present, must be an object`);
    }
    if (entry.installed !== undefined && !Array.isArray((entry.installed as Record<string, unknown>).packages)) {
      throw new CliInputError(`repositories[${index}].installed.packages, when present, must be an array`);
    }
    return {
      repository,
      declaration: entry.declaration,
      installed: entry.installed as FleetInstalledInventory | undefined,
    };
  });
  return { packages: packages as string[], repositories: parsedRepositories };
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

/** Renders the report as a table a CI job summary can display verbatim. */
export function renderReport(report: FleetCoverageReport): string {
  const lines = [
    "## observer-coverage-check",
    "",
    "| package | repository | state | detail |",
    "| --- | --- | --- | --- |",
  ];
  for (const coverageCell of report.cells) {
    const detail =
      coverageCell.state === "declared-absent"
        ? coverageCell.reason
        : coverageCell.state === "unclassified"
          ? `${coverageCell.reason}${coverageCell.detail ? ` — ${coverageCell.detail}` : ""}`
          : (coverageCell.installedVersion ?? "");
    lines.push(`| ${cell(coverageCell.package)} | ${cell(coverageCell.repository)} | ${cell(coverageCell.state)} | ${cell(detail)} |`);
  }
  lines.push(
    "",
    `Counts: installed=${report.countsByState.installed} declared-absent=${report.countsByState.declaredAbsent} unclassified=${report.countsByState.unclassified}`,
  );
  if (report.contradictions.length > 0) {
    lines.push("", "Contradictions (installed AND declared-absent for the same package):");
    for (const contradiction of report.contradictions) {
      lines.push(`- ${contradiction.package} in ${contradiction.repository}: declared reason ${JSON.stringify(contradiction.declaredReason)}`);
    }
  }
  const overallLabel =
    report.result.verdict === "satisfied" ? "SATISFIED" : report.result.verdict === "violated" ? "VIOLATED" : "INDETERMINATE";
  lines.push("", `Overall: ${overallLabel} (exit ${fleetCoverageVerdictToExitCode(report.result)})`);
  if (report.result.verdict === "indeterminate") {
    lines.push("", `Reason: ${report.result.reason} -- ${report.result.detail}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Runs the command. Returns the exit code rather than setting it -- see the
 * module header.
 */
export function main(argv: readonly string[], port: CliPort): 0 | 1 | 2 {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    port.writeErr(`observer-coverage-check: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }

  if (args.help) {
    port.writeOut(USAGE);
    return 0;
  }

  if (args.inputPath === undefined) {
    port.writeErr(`observer-coverage-check: --input is required\n\n${USAGE}`);
    return 2;
  }

  let rawInput: unknown;
  try {
    const text = port.readTextFile(args.inputPath);
    rawInput = JSON.parse(text);
  } catch (error) {
    port.writeErr(
      `observer-coverage-check: could not read or parse the input document at ${args.inputPath}: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  let input: FleetCoverageInput;
  try {
    input = parseCliInput(rawInput);
  } catch (error) {
    port.writeErr(`observer-coverage-check: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }

  // gradeFleetCoverage throws only on a caller precondition (a duplicate or
  // empty identifier) -- a real programming error in the assembled input,
  // never something found inside a declaration or an inventory. Caught here
  // so it can only ever produce a 2, never be mistaken for a violation.
  let report: FleetCoverageReport;
  try {
    report = gradeFleetCoverage(input);
  } catch (error) {
    port.writeErr(
      `observer-coverage-check: the run did not complete, so nothing has been established: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  port.writeOut(args.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report));
  return fleetCoverageVerdictToExitCode(report.result);
}
