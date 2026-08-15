/**
 * `repository-check` — the intentionally small CLI around the pure
 * repository-profile validator. It reads exactly one JSON file, emits one
 * deterministic JSON report, and never invokes a consumer command or Git.
 *
 * Exit codes:
 *   0 — the profile is valid.
 *   1 — JSON was read successfully but the profile has validation findings.
 *   2 — the CLI could not run: bad arguments, unreadable input, or malformed
 *       JSON. This is deliberately distinct from an invalid profile.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { validateRepositoryProfile } from "./validate.js";
import type { RepositoryProfileFinding } from "./types.js";

const USAGE = `Usage: repository-check <profile-file>

  profile-file  Path to one JSON file containing a repository profile. Required.

Options:
  --help        Print this message and exit 0.

Exit codes: 0 = valid profile, 1 = validation findings, 2 = could not run (bad arguments, unreadable input, or malformed JSON).
`;

/** An argument or input-read failure, always mapped to exit code 2 by `run`. */
export class CliInputError extends Error {}

export interface RepositoryCheckReport {
  readonly ok: boolean;
  readonly findings: readonly RepositoryProfileFinding[];
}

function parseArgs(argv: readonly string[]): { profileFile?: string; help: boolean } {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  if (argv.length === 0) throw new CliInputError("profile-file is required");
  if (argv.length !== 1) throw new CliInputError("expected exactly one profile-file argument");

  const profileFile = argv[0];
  if (profileFile === undefined || profileFile.startsWith("-")) {
    throw new CliInputError(`unknown option ${JSON.stringify(profileFile ?? "")}`);
  }
  return { profileFile, help: false };
}

function readProfileText(path: string): string {
  if (!existsSync(path)) throw new CliInputError(`profile-file ${JSON.stringify(path)} does not exist`);

  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    throw new CliInputError(`cannot read profile-file ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile()) throw new CliInputError(`profile-file ${JSON.stringify(path)} is not a file`);

  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new CliInputError(`cannot read profile-file ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new CliInputError(`profile-file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function printReport(report: RepositoryCheckReport): void {
  console.log(JSON.stringify(report, null, 2));
}

/**
 * Runs the CLI without reading global process arguments so the complete
 * argument-to-exit-code contract can be tested directly.
 */
export function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const profilePath = resolve(args.profileFile as string);
  const value = parseJson(readProfileText(profilePath));
  const findings = validateRepositoryProfile(value);
  printReport({ ok: findings.length === 0, findings });
  return findings.length === 0 ? 0 : 1;
}

export function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`repository-check: ${message}`);
    if (!(error instanceof CliInputError)) console.error("repository-check: unexpected error");
    process.exitCode = 2;
  }
}
