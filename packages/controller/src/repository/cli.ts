/**
 * `repository-check` — the intentionally small CLI around the pure
 * repository-profile validator. It locates and reads exactly one
 * declaration, emits one deterministic JSON report, and never invokes a
 * consumer command or Git.
 *
 * Locating a declaration (issue #315) is this CLI's own job, not the pure
 * evaluator's: `governance/repository-profile.json` is the canonical
 * location and is always used when present. Given no argument, or a
 * directory argument, this command searches for a declaration under that
 * root without being told exactly where it is. A declaration found at any
 * other path is never conflated with "no declaration" — it is reported as
 * a distinct, non-canonical-location finding, together with whatever the
 * declaration's own content validates as. Passing a file directly still
 * validates exactly that file, with no location search at all.
 *
 * Exit codes:
 *   0 — a declaration exists at the canonical location and is valid.
 *   1 — the CLI ran to completion but found something to report: an
 *       invalid profile, a declaration at a non-canonical location, or no
 *       declaration at all.
 *   2 — the CLI could not run: bad arguments, unreadable input, or
 *       malformed JSON. Deliberately distinct from a failing check: this
 *       gate never resolves not-run as success, and never conflates "could
 *       not run" with "ran and failed."
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { CANONICAL_REPOSITORY_PROFILE_PATH } from "./types.js";
import { locateRepositoryProfile } from "./locate.js";
import { validateRepositoryProfile } from "./validate.js";
import type { RepositoryDeclarationLocationFinding } from "./types.js";

const USAGE = `Usage: repository-check [path]

  path  Optional. Either a repository profile JSON file to validate
        directly, or a repository root directory to search for a
        declaration in (the canonical location is
        ${CANONICAL_REPOSITORY_PROFILE_PATH}). Defaults to the current
        working directory when omitted.

Options:
  --help        Print this message and exit 0.

Exit codes: 0 = a valid declaration exists at the canonical location, 1 = a finding was reported (an invalid profile, a non-canonical location, or no declaration at all), 2 = could not run (bad arguments, unreadable input, or malformed JSON).
`;

/** An argument or input-read failure, always mapped to exit code 2 by `run`. */
export class CliInputError extends Error {}

export interface RepositoryCheckReport {
  readonly ok: boolean;
  readonly findings: readonly RepositoryDeclarationLocationFinding[];
}

function parseArgs(argv: readonly string[]): { path?: string; help: boolean } {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  if (argv.length > 1) throw new CliInputError("expected at most one path argument");

  const path = argv[0];
  if (path !== undefined && path.startsWith("-")) {
    throw new CliInputError(`unknown option ${JSON.stringify(path)}`);
  }
  return { path, help: false };
}

function readDeclarationText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new CliInputError(`cannot read ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseJson(path: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new CliInputError(`${JSON.stringify(path)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function printReport(report: RepositoryCheckReport): void {
  console.log(JSON.stringify(report, null, 2));
}

function notFoundFinding(): RepositoryDeclarationLocationFinding {
  return {
    rule: "declaration-not-found",
    severity: "error",
    path: "$",
    message: `No repository declaration was found. Author one at the canonical location "${CANONICAL_REPOSITORY_PROFILE_PATH}".`,
  };
}

function nonCanonicalLocationFinding(foundAt: string): RepositoryDeclarationLocationFinding {
  return {
    rule: "declaration-non-canonical-location",
    severity: "error",
    path: "$",
    message: `A repository declaration was found at "${foundAt}", not the canonical "${CANONICAL_REPOSITORY_PROFILE_PATH}". Move it there.`,
  };
}

type ResolvedInput =
  | { readonly kind: "not-found" }
  | { readonly kind: "explicit-file"; readonly absolutePath: string }
  | { readonly kind: "located"; readonly absolutePath: string; readonly relativePath: string; readonly canonical: boolean };

/**
 * Resolves the CLI's single optional argument into exactly what to read.
 * An argument that is a file is validated directly, with no location
 * search — the caller already knows where its declaration is. An argument
 * that is a directory, or no argument at all (defaulting to the current
 * working directory), is searched via `locateRepositoryProfile`.
 */
function resolveInput(pathArgument: string | undefined): ResolvedInput {
  const root = pathArgument === undefined ? process.cwd() : resolve(pathArgument);
  if (pathArgument !== undefined) {
    if (!existsSync(root)) throw new CliInputError(`path ${JSON.stringify(pathArgument)} does not exist`);
    let stat;
    try {
      stat = statSync(root);
    } catch (error) {
      throw new CliInputError(`cannot read path ${JSON.stringify(pathArgument)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (stat.isFile()) return { kind: "explicit-file", absolutePath: root };
    if (!stat.isDirectory()) throw new CliInputError(`path ${JSON.stringify(pathArgument)} is not a file or directory`);
  }

  const located = locateRepositoryProfile(root);
  if (!located) return { kind: "not-found" };
  return {
    kind: "located",
    absolutePath: join(root, ...located.path.split("/")),
    relativePath: located.path,
    canonical: located.canonical,
  };
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

  const resolved = resolveInput(args.path);
  if (resolved.kind === "not-found") {
    const findings = [notFoundFinding()];
    printReport({ ok: false, findings });
    return 1;
  }

  const value = parseJson(resolved.absolutePath, readDeclarationText(resolved.absolutePath));
  const contentFindings = validateRepositoryProfile(value);
  const findings = resolved.kind === "located" && !resolved.canonical
    ? [nonCanonicalLocationFinding(resolved.relativePath), ...contentFindings]
    : contentFindings;
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
