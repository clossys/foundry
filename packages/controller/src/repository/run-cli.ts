/**
 * `repository-profile-check` — the CLI for `runRepositoryProfileCheck`
 * (issue #321): the single command a consumer invokes instead of writing
 * its own 300-line runner. This file is presentation and I/O only —
 * locate and read exactly one declaration file, optionally read one
 * caller-supplied discovery file, call `runRepositoryProfileCheck`, print a
 * legible report, exit through the shared ternary. All decision-making
 * happens in `./run.js`.
 *
 * Locating the declaration reuses `locateRepositoryProfile`
 * (`./locate.js`), the exact same discovery `repository-check` (`./cli.ts`)
 * already uses (issue #315): the canonical location
 * (`governance/repository-profile.json`) is always checked first and, when
 * present, is always what gets used.
 *
 * DISCOVERY OF THE REPOSITORY'S REAL STATE — requirement observations and
 * the root direct-child listing — is NOT this file's job either. It is read
 * from one caller-supplied JSON file (`--discovery <file>`), never shelled
 * out to `git` or crawled from the filesystem here. A consumer's own CI job
 * performs its own discovery however it needs to (a filesystem walk, `git
 * ls-tree`, a manifest cross-reference — the exact three approaches the five
 * duplicated runners each picked) and writes the result as one JSON file in
 * this shape:
 *
 * ```json
 * {
 *   "requirementObservations": [
 *     { "id": "runtime.node", "scope": "machine", "state": "observed", "value": "20" }
 *   ],
 *   "rootObservedEntries": ["README.md", "src"]
 * }
 * ```
 *
 * Both keys are optional and independent. An absent `requirementObservations`
 * behaves exactly like `[]` (see `./run.ts`'s doc comment: every declared
 * requirement folds to `unknown`, and an unevidenced requirement fails
 * closed as `indeterminate`, never `satisfied`). An absent
 * `rootObservedEntries` is NOT the same as `[]` — it means root discovery
 * never ran; a profile that declares any root entry gets `indeterminate`,
 * not a real evaluation against zero observed children. Omitting
 * `--discovery` entirely is exactly `{}`: no requirement observations, no
 * root discovery.
 *
 * Exit codes — this repository's shared gate-result ternary
 * (`@vespeneventures/controller/gates`'s `GateResult`), projected by
 * `gateResultToExitCode`:
 *
 *   0 — satisfied: the declaration is valid and canonically located, and
 *       every declared requirement and root entry it names was evaluated
 *       and holds.
 *   1 — violated: evaluated cleanly, and something is wrong — no
 *       declaration, a non-canonically located one, an unsatisfied
 *       requirement, a missing required root entry, or an observed
 *       prohibited one.
 *   2 — indeterminate: could not evaluate. Bad arguments, an unreadable or
 *       non-JSON declaration, a declaration that parses as JSON but fails
 *       schema validation (never routed to evaluation — see `./run.ts`'s
 *       header comment for the shipped defect this makes structurally
 *       impossible), or declared requirements/root entries with no
 *       conclusive discovery behind them.
 *
 * Importing this module is inert, the same discipline `./cli.ts` documents
 * for `repository-check`: no filesystem I/O, no `console` output, no exit
 * code, on import alone. The installed `repository-profile-check` command
 * enters through a separate executable-only wrapper, `./run-bin.ts`; only an
 * explicit invocation of `run()` (or `main()`) reads anything or reports.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { locateRepositoryProfile } from "./locate.js";
import { gateResultToExitCode } from "../gates/result.js";
import {
  runRepositoryProfileCheck,
  type RepositoryProfileRunDeclarationState,
  type RepositoryProfileRunFinding,
  type RepositoryProfileRunResult,
} from "./run.js";
import type { RepositoryList, RepositoryRequirementObservation } from "./types.js";

const USAGE = `Usage: repository-profile-check [path] [--discovery <file>]

  path              Optional. Either a repository profile JSON file to check
                     directly, or a repository root directory to search for
                     a declaration in (the canonical location is
                     governance/repository-profile.json). Defaults to the
                     current working directory when omitted.

Options:
  --discovery <file>  Optional. Path to one JSON file with the caller's
                       injected discovery: { "requirementObservations": [...],
                       "rootObservedEntries": [...] }. Both keys are
                       optional. Omitting this flag entirely is the same as
                       an empty object: no requirement evidence, no root
                       discovery.
  --help              Print this message and exit 0.

Exit codes: 0 = satisfied, 1 = violated, 2 = indeterminate (could not evaluate — see README).
`;

/** An argument or input-read failure. Always maps to exit code 2. */
export class CliInputError extends Error {}

interface ParsedArgs {
  readonly path?: string;
  readonly discoveryFile?: string;
  readonly help: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let path: string | undefined;
  let discoveryFile: string | undefined;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "--discovery") {
      const value = argv[++index];
      if (value === undefined) throw new CliInputError("--discovery requires a value");
      discoveryFile = value;
      continue;
    }
    if (arg.startsWith("-")) throw new CliInputError(`unknown option ${JSON.stringify(arg)}`);
    if (path !== undefined) throw new CliInputError(`unexpected extra argument ${JSON.stringify(arg)}`);
    path = arg;
  }

  return { path, discoveryFile, help };
}

function readJsonFile(path: string, label: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new CliInputError(`${label} ${JSON.stringify(path)} does not exist`);
  let text: string;
  try {
    if (!statSync(resolved).isFile()) throw new CliInputError(`${label} ${JSON.stringify(path)} is not a file`);
    text = readFileSync(resolved, "utf8");
  } catch (error) {
    if (error instanceof CliInputError) throw error;
    throw new CliInputError(`cannot read ${label} ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliInputError(`${label} ${JSON.stringify(path)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isPlainArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

interface Discovery {
  readonly requirementObservations: RepositoryList<RepositoryRequirementObservation>;
  readonly rootObservedEntries: RepositoryList<string> | undefined;
}

/**
 * Reads and loosely shape-checks the discovery file: is it an object, are
 * its two known keys arrays when present. Deliberately shallow — every
 * finer-grained validation (an individual observation's shape, duplicate
 * identities, an invalid root-entry name) is already `evaluateRepositoryRequirements`'s
 * and `evaluateRepositoryRoot`'s own job, reached through `runRepositoryProfileCheck`,
 * and reported as `indeterminate` there rather than re-validated here.
 */
function readDiscovery(discoveryFile: string | undefined): Discovery {
  if (discoveryFile === undefined) return { requirementObservations: [], rootObservedEntries: undefined };

  const value = readJsonFile(discoveryFile, "discovery file");
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CliInputError(`discovery file ${JSON.stringify(discoveryFile)} must contain a JSON object`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "requirementObservations" && key !== "rootObservedEntries") {
      throw new CliInputError(`discovery file ${JSON.stringify(discoveryFile)} has an unknown field ${JSON.stringify(key)}`);
    }
  }

  const requirementObservationsRaw = record.requirementObservations;
  if (requirementObservationsRaw !== undefined && !isPlainArray(requirementObservationsRaw)) {
    throw new CliInputError(`discovery file ${JSON.stringify(discoveryFile)}: requirementObservations must be an array`);
  }
  const rootObservedEntriesRaw = record.rootObservedEntries;
  if (rootObservedEntriesRaw !== undefined && !isPlainArray(rootObservedEntriesRaw)) {
    throw new CliInputError(`discovery file ${JSON.stringify(discoveryFile)}: rootObservedEntries must be an array`);
  }

  return {
    requirementObservations: (requirementObservationsRaw ?? []) as RepositoryRequirementObservation[],
    rootObservedEntries: rootObservedEntriesRaw as string[] | undefined,
  };
}

type ResolvedDeclarationPath =
  | { readonly kind: "not-found" }
  | { readonly kind: "resolved"; readonly absolutePath: string; readonly relativePath: string; readonly canonical: boolean };

function resolveDeclarationPath(pathArgument: string | undefined): ResolvedDeclarationPath {
  const root = pathArgument === undefined ? process.cwd() : resolve(pathArgument);
  if (pathArgument !== undefined) {
    if (!existsSync(root)) throw new CliInputError(`path ${JSON.stringify(pathArgument)} does not exist`);
    let stat;
    try {
      stat = statSync(root);
    } catch (error) {
      throw new CliInputError(`cannot read path ${JSON.stringify(pathArgument)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (stat.isFile()) return { kind: "resolved", absolutePath: root, relativePath: pathArgument, canonical: true };
    if (!stat.isDirectory()) throw new CliInputError(`path ${JSON.stringify(pathArgument)} is not a file or directory`);
  }

  const located = locateRepositoryProfile(root);
  if (!located) return { kind: "not-found" };
  return {
    kind: "resolved",
    absolutePath: join(root, ...located.path.split("/")),
    relativePath: located.path,
    canonical: located.canonical,
  };
}

function readDeclaration(pathArgument: string | undefined): RepositoryProfileRunDeclarationState {
  const resolved = resolveDeclarationPath(pathArgument);
  if (resolved.kind === "not-found") return { kind: "not-found" };

  let text: string;
  try {
    text = readFileSync(resolved.absolutePath, "utf8");
  } catch (error) {
    return { kind: "unreadable", detail: `cannot read ${JSON.stringify(resolved.relativePath)}: ${error instanceof Error ? error.message : String(error)}` };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { kind: "invalid-json", detail: `${JSON.stringify(resolved.relativePath)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { kind: "parsed", path: resolved.relativePath, canonical: resolved.canonical, value };
}

function formatFinding(finding: RepositoryProfileRunFinding): string {
  return `  [${finding.severity}] ${finding.rule} (${finding.path}): ${finding.message}`;
}

function describeDeclaration(declaration: RepositoryProfileRunDeclarationState): string {
  switch (declaration.kind) {
    case "not-found":
      return "Declaration: none found.";
    case "unreadable":
      return `Declaration: unreadable (${declaration.detail}).`;
    case "invalid-json":
      return `Declaration: not valid JSON (${declaration.detail}).`;
    case "parsed":
      return `Declaration: ${declaration.path}${declaration.canonical ? "" : " (non-canonical location)"}.`;
    default: {
      const unhandled: never = declaration;
      throw new Error(`repository-profile-check: unknown declaration state ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * Prints a report legible on its own: what declaration was found, the
 * verdict, and — for `violated` — every finding, so a consumer never needs
 * its own reporting layer to learn which surface drifted.
 */
function printReport(declaration: RepositoryProfileRunDeclarationState, result: RepositoryProfileRunResult): void {
  console.log(describeDeclaration(declaration));

  switch (result.verdict) {
    case "satisfied":
      console.log(`repository-profile-check: satisfied (${result.evaluated} evaluated). No findings.`);
      return;
    case "violated":
      console.log(`repository-profile-check: violated (${result.findings.length} finding${result.findings.length === 1 ? "" : "s"}).`);
      for (const finding of result.findings) console.log(formatFinding(finding));
      return;
    case "indeterminate":
      console.error(`repository-profile-check: indeterminate (${result.reason}).${result.detail ? ` ${result.detail}` : ""}`);
      console.error("Refusing to report a pass for a check that did not fully evaluate.");
      return;
    default: {
      const unhandled: never = result;
      throw new Error(`repository-profile-check: unknown verdict ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Runs without reading global process arguments so the exit-code contract is directly testable. */
export function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const declaration = readDeclaration(args.path);
  const discovery = readDiscovery(args.discoveryFile);
  const result = runRepositoryProfileCheck({
    declaration,
    requirementObservations: discovery.requirementObservations,
    rootObservedEntries: discovery.rootObservedEntries,
  });
  printReport(declaration, result);
  return gateResultToExitCode(result);
}

export function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`repository-profile-check: ${error.message}`);
      console.error(`\n${USAGE}`);
    } else {
      console.error(`repository-profile-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }
    process.exitCode = 2;
  }
}
