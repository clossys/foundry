#!/usr/bin/env node
/** CLI for strategy cells, grounding and active prohibitions. Exit 0 clean, 1 findings, 2 could not run. */
import { runReviewCli, REVIEW_USAGE } from "./cli/review.js";
import { runCitationIndex } from "./citations/cli.js";
import { runWriteCli } from "./write/cli.js";
import { existsSync, realpathSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkGrounding, type FactsGateResult } from "./facts-gate.js";
import { readGroundRoot } from "./ground/read.js";
import { readStrategyRoot } from "./store.js";
import { DEFAULT_SKIP_DIRS, scanStrategyDirectory } from "./scan.js";
import { checkWontClaimDrift, type WontClaimResult } from "./wont-claim-drift.js";
import { executeBriefCommand } from "./cli/brief.js";
import { executeChecksCommand } from "./cli/checks.js";
import { isReadCommand, READ_USAGE, runReadCommand } from "./cli/read.js";
import { persistReport } from "./cli/reports.js";
import { resolveStrategyRoot } from "./strategy-dir-default.js";

const USAGE = `Usage: strategist-check ground [<strategy-dir>] <scan-dir> [options]
   or: strategist-check <strategy-dir> <scan-dir> [options]
   or: strategist-check wont-claim <strategy-dir> <scan-dir> [options]

The strategy root defaults to <repo root>/clossys/agents/strategist (cwd outside a repository); --root overrides it.
--json prints the result as JSON. --help prints usage.
--extensions <ext>, --skip-dirs <name>, and --exclude <glob> are repeatable scan options.
Grounding reads findings/*.md. Exit codes: 0 clean, 1 findings, 2 could not run.
Run "strategist-check wont-claim --help" for active prohibitions.
${READ_USAGE}
${REVIEW_USAGE}
`;

const WONT_CLAIM_USAGE = `Usage: strategist-check wont-claim <strategy-dir> <scan-dir> [options]

  strategy-dir   Directory containing tree.json and the active Proof and Voice cells. Defaults to <repo root>/clossys/agents/strategist (cwd outside a repository); --root overrides it.
  scan-dir       Directory to scan for surfaces that make a claim the record says must never be made.

Options:
  --help                   Print this message and exit 0.
  --extensions <ext>       File extension to scan (repeatable; include the leading dot).
  --skip-dirs <name>       Directory name to skip during the walk (repeatable), added to the built-in skip list.
  --exclude <glob>         Repo-relative path glob to omit (repeatable).

Default extensions are .md, .mdx, .txt, .html, .htm, .json, .yml and .yaml; code files opt in through --extensions. Quoted Never-claim: phrases from active Proof and Never: phrases from active Voice are checked; unquoted labels are listed as unchecked. A comment with wont-claim:ignore is recorded and not checked. --root overrides the strategy directory; --json prints the result as JSON.

Exit codes: 0 = clean, 1 = hit (at least one scanned surface makes a recorded claim), 2 = could not run (tree or active cells missing/unreadable/invalid, no files scanned, an over-long line, an unreadable directory, or bad arguments).
The returned report is saved to <root>/reports/wont-claim.json.

`;

/** Exported for `cli.test.ts` — anything wrong with the arguments themselves always maps to exit code 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  strategyDir?: string;
  scanDir?: string;
  extensions: string[];
  skipDirs: string[];
  excludeGlobs: string[];
  help: boolean;
}

function parseExtensionFlag(value: string): string {
  if (!value.startsWith(".") || value.length < 2 || value.includes("/")) {
    throw new CliInputError(
      'each --extensions value must include the leading dot and name only, e.g. --extensions .md (not "md" or ".")',
    );
  }
  return value;
}

/** Exported for `cli.test.ts` — argv parsing for the default facts-check subcommand only. */
export function parseArgs(argv: string[]): ParsedArgs {
  let strategyDir: string | undefined;
  let scanDir: string | undefined;
  const extensions: string[] = [];
  const skipDirs: string[] = [];
  const excludeGlobs: string[] = [];
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--extensions") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new CliInputError('--extensions requires an extension argument, e.g. --extensions .md');
      }
      extensions.push(parseExtensionFlag(value));
      i += 1;
      continue;
    }
    if (arg.startsWith("--extensions=")) {
      const value = arg.slice("--extensions=".length);
      if (value.length === 0) {
        throw new CliInputError('--extensions requires an extension argument, e.g. --extensions .md');
      }
      extensions.push(parseExtensionFlag(value));
      continue;
    }
    if (arg === "--skip-dirs") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new CliInputError('--skip-dirs requires a directory name argument, e.g. --skip-dirs vendor');
      }
      skipDirs.push(value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--skip-dirs=")) {
      const value = arg.slice("--skip-dirs=".length);
      if (value.length === 0) {
        throw new CliInputError('--skip-dirs requires a directory name argument, e.g. --skip-dirs vendor');
      }
      skipDirs.push(value);
      continue;
    }
    if (arg === "--exclude") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new CliInputError('--exclude requires a path glob argument, e.g. --exclude "**/*.test.ts"');
      }
      excludeGlobs.push(value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--exclude=")) {
      const value = arg.slice("--exclude=".length);
      if (value.length === 0) {
        throw new CliInputError('--exclude requires a path glob argument, e.g. --exclude "**/*.test.ts"');
      }
      excludeGlobs.push(value);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    }
    if (strategyDir === undefined) {
      strategyDir = arg;
    } else if (scanDir === undefined) {
      scanDir = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { strategyDir, scanDir, extensions, skipDirs, excludeGlobs, help };
}


function isWithinRoot(file: string, root: string): boolean {
  const path = relative(root, file);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep));
}

function parseGroundArgs(argv: string[]): ParsedArgs & { json: boolean } {
  const rest: string[] = []; let root: string | undefined; let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") { json = true; continue; }
    if (arg === "--root" || arg.startsWith("--root=")) {
      const value = arg === "--root" ? argv[++i] : arg.slice(7);
      if (!value || value.startsWith("-")) throw new CliInputError("--root requires a directory");
      if (root !== undefined) throw new CliInputError("--root may be given only once");
      root = value; continue;
    }
    rest.push(arg);
  }
  const args = parseArgs(rest);
  if (root !== undefined) {
    if (args.scanDir !== undefined) throw new CliInputError("--root accepts only the scan-dir positional");
    args.scanDir = args.strategyDir; args.strategyDir = root;
  } else if (args.strategyDir !== undefined && args.scanDir === undefined) {
    args.scanDir = args.strategyDir; args.strategyDir = undefined;
  }
  args.strategyDir ??= resolveStrategyRoot();
  return { ...args, json };
}

function requireDirectory(label: string, path: string): void {
  if (!existsSync(path)) throw new CliInputError(`${label} "${path}" does not exist`);
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    throw new CliInputError(`cannot read ${label} "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isDirectory()) throw new CliInputError(`${label} "${path}" is not a directory`);
}

function resolveStrategyDirArgument(explicit: string | undefined): { dir: string } {
  return { dir: resolveStrategyRoot(explicit) };
}

function readStrategyFacts(strategyDir: string) {
  const read = readGroundRoot(strategyDir);
  return { mode: "findings", facts: read.model.findings, issues: read.issues.map(detail => ({ file: "findings/", reason: "invalid-findings", detail })) };
}

function printReport(result: FactsGateResult): void {
  console.log(
    `Scanned ${result.filesScanned} file${result.filesScanned === 1 ? "" : "s"}, ` +
      `${result.claimsScanned} claim-shaped match${result.claimsScanned === 1 ? "" : "es"}.`,
  );
  if (result.ignored.length > 0) {
    console.log(`${result.ignored.length} explicitly ignored via "facts-gate:ignore":`);
    for (const ig of result.ignored) console.log(`  ${ig.file}:${ig.line}  ${ig.snippet}`);
  }
  if (result.findings.length === 0) {
    console.log("No findings.");
    return;
  }
  console.log(`\n${result.findings.length} finding(s):`);
  for (const f of result.findings) {
    console.log(`  [${f.rule}] ${f.file}:${f.line}  ${f.message}`);
  }
}

const SURFACE_DEFAULT_EXTENSIONS = [".md", ".mdx", ".txt", ".html", ".htm", ".json", ".yml", ".yaml"];

function printWontClaimReport(result: WontClaimResult): void {
  console.log(`Scanned ${result.filesScanned} file${result.filesScanned === 1 ? "" : "s"}.`);
  if (result.ignored.length > 0) {
    console.log(`${result.ignored.length} explicitly ignored via "wont-claim:ignore":`);
    for (const ig of result.ignored) console.log(`  ${ig.file}:${ig.line}  ${ig.snippet}`);
  }
  if (result.unchecked.length > 0) {
    console.log(`${result.unchecked.length} entr${result.unchecked.length === 1 ? "y" : "ies"} with no quoted phrases, not mechanically checked: ${result.unchecked.join(", ")}`);
  }
  if (result.findings.length > 0) {
    console.log(`\n${result.findings.length} finding(s):`);
    for (const f of result.findings) console.log(`  [${f.id}] ${f.file}:${f.line}  ${f.message}`);
  }
  if (result.state === "clean") {
    console.log("Won't claim: clean.");
  } else if (result.state === "hit") {
    console.log("Won't claim: hit.");
  } else {
    console.log("Won't claim: indeterminate.");
    for (const reason of result.indeterminateReasons) console.error(`  ${reason}`);
  }
}

/**
 * `wont-claim`'s own `main`-equivalent. A missing/unreadable/invalid record
 * and zero files matched are refused here with `2` before the pure check
 * runs; the check's own "indeterminate" state also maps to `2` and wins over
 * a hit, so "could not fully check" is never masked by findings from the part
 * that did run.
 */
function runWontClaim(argv: string[]): number {
  const args = parseGroundArgs(argv);
  if (args.help) {
    console.log(args.json ? JSON.stringify({ command: "wont-claim", code: 0, help: WONT_CLAIM_USAGE }) : WONT_CLAIM_USAGE);
    return 0;
  }
  if (!args.scanDir) throw new CliInputError("scan-dir is required");
  const strategyDirResolution = resolveStrategyDirArgument(args.strategyDir);
  const strategyDir = strategyDirResolution.dir;
  const scanDir = resolve(args.scanDir);
  requireDirectory("strategy-dir", strategyDir);
  requireDirectory("scan-dir", scanDir);

  if (!args.json) console.log(`Strategy directory: ${strategyDir}`);
  if (!args.json) console.log(`Scan directory: ${scanDir}`);

  const model = readStrategyRoot(strategyDir);

  const scanOptions: { extensions: string[]; skipDirs?: string[]; excludeGlobs?: string[] } = {
    extensions: args.extensions.length > 0 ? args.extensions : SURFACE_DEFAULT_EXTENSIONS,
  };
  if (args.skipDirs.length > 0) scanOptions.skipDirs = [...DEFAULT_SKIP_DIRS, ...args.skipDirs];
  if (args.excludeGlobs.length > 0) scanOptions.excludeGlobs = args.excludeGlobs;
  const files = scanStrategyDirectory(scanDir, scanOptions); // throws (fail-closed) on an unreadable directory — caught by run()

  const surfaces = files.filter(file => !isWithinRoot(resolve(scanDir, file.path), strategyDir));
  const result = checkWontClaimDrift(surfaces, model);
  persistReport(strategyDir, "wont-claim", result);
  const code = result.state === "indeterminate" ? 2 : result.state === "hit" ? 1 : 0;
  if (args.json) {
    console.log(JSON.stringify({ command: "wont-claim", code, result }));
    return code;
  }
  printWontClaimReport(result);
  if (result.state === "indeterminate") {
    console.error("Refusing to report a pass for a check that could not run in full.");
    return 2;
  }
  return result.state === "hit" ? 1 : 0;
}

/**
 * Exported (unlike a typical CLI `main`) so `cli.test.ts` can exercise the
 * whole argv-to-exit-code contract directly, against a real `mkdtemp` temp
 * directory, without spawning a subprocess for every case. Takes `argv`
 * as a parameter rather than reading `process.argv` itself for exactly
 * that reason — `run()` below is the only caller that reads the real
 * `process.argv`.
 */
export function main(argv: string[]): number {
  if (argv[0] === "review") return runReviewCli(argv.slice(1));
  const writeResult = runWriteCli(argv);
  if (writeResult !== undefined) return writeResult;
  if (argv[0] === "index") return runCitationIndex(argv.slice(1));
  if (isReadCommand(argv)) {
    return runReadCommand(argv, { execute: args => args.command === "brief" || args.command === "handoff" ? executeBriefCommand(args) : executeChecksCommand(args) });
  }
  if (argv[0] === "wont-claim") {
    try { return runWontClaim(argv.slice(1)); } catch (error) {
      if (!argv.includes("--json")) throw error;
      console.log(JSON.stringify({ command: "wont-claim", code: 2, error: error instanceof Error ? error.message : String(error) }));
      return 2;
    }
  }

  const args = parseGroundArgs(argv[0] === "ground" ? argv.slice(1) : argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const strategyDirResolution = resolveStrategyDirArgument(args.strategyDir);
  const strategyDir = strategyDirResolution.dir;
  const scanDir = resolve(args.scanDir ?? process.cwd());
  requireDirectory("strategy-dir", strategyDir);
  requireDirectory("scan-dir", scanDir);

  if (!args.json) console.log(`Strategy directory: ${strategyDir}`);
  if (!args.json) console.log(`Scan directory: ${scanDir}`);

  const loaded = readStrategyFacts(strategyDir);
  const issues = loaded.issues;
  if (!args.json && issues.length > 0 && loaded.mode === "findings") {
    console.log(`\n${issues.length} strategy file issue(s):`);
    for (const issue of issues) {
      console.log(`  [${issue.reason}] ${issue.file}: ${issue.detail}`);
    }
  } else if (!args.json && issues.length > 0) {
    console.log(`\n${issues.length} facts directory issue(s):`);
    for (const issue of issues) {
      console.log(`  [${issue.reason}] ${issue.file}: ${issue.detail}`);
    }
  }

  // Any registry issue makes grounding indeterminate.
  const factsIssue = issues[0];
  if (factsIssue) {
    if (args.json) return printGroundIndeterminate(issues.map(issue => `[${issue.reason}] ${issue.file}: ${issue.detail}`));
    console.error(`\nFacts could not be loaded (${factsIssue.reason}: ${factsIssue.detail}).`);
    console.error("Refusing to report a pass with no trustworthy facts to check prose against.");
    return 2;
  }

  const facts = loaded.facts;

  const scanOptions: { extensions?: string[]; skipDirs?: string[]; excludeGlobs?: string[] } = {};
  if (args.extensions.length > 0) {
    scanOptions.extensions = args.extensions;
  }
  if (args.skipDirs.length > 0) {
    scanOptions.skipDirs = [...DEFAULT_SKIP_DIRS, ...args.skipDirs];
  }
  if (args.excludeGlobs.length > 0) {
    scanOptions.excludeGlobs = args.excludeGlobs;
  }
  const files = scanStrategyDirectory(scanDir, scanOptions); // throws (fail-closed) on an unreadable directory — caught by run()

  // Zero files matched is the exact failure mode this gate is built to
  // never silently pass: "nothing to scan" is not the same thing as "scanned
  // everything, found nothing wrong" — see the package README.
  if (files.length === 0) {
    if (args.json) return printGroundIndeterminate([`No files matched under "${scanDir}" — nothing was scanned.`]);
    console.error(`\nNo files matched under "${scanDir}" — nothing was scanned.`);
    console.error("Refusing to report a pass for a scan that checked nothing.");
    return 2;
  }

  const surfaces = files.filter(file => !isWithinRoot(resolve(scanDir, file.path), strategyDir));
  if (!surfaces.length) {
    if (args.json) return printGroundIndeterminate(["No surface files scanned outside the strategy root."]);
    console.error("No surface files scanned outside the strategy root."); return 2;
  }
  const result = checkGrounding(surfaces, facts);
  if (args.json) console.log(JSON.stringify(result));
  else printReport(result);

  return result.findings.length > 0 ? 1 : 0;
}

/** Grounding failures still produce one machine-readable result under --json. */
function printGroundIndeterminate(indeterminateReasons: string[]): 2 {
  console.log(JSON.stringify({ state: "indeterminate", findings: [], ignored: [], filesScanned: 0, claimsScanned: 0, indeterminateReasons }));
  return 2;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`strategist-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(
        `strategist-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
      process.exitCode = 2;
    }
  }
}

/**
 * Same real-path guard `@example/gates`' `cli.ts` uses, for the same
 * reason: `npm install` publishes `bin` entries as symlinks, so comparing
 * `process.argv[1]` to `import.meta.url` without resolving symlinks on both
 * sides fails the moment this file is actually invoked the only way it
 * ships — as an installed CLI — and does so silently (`run()` never fires,
 * nothing prints, exit code 0). See that file's doc comment for the full
 * story; this is the same fix, applied here.
 */
function detectMainModule(): boolean {
  const argvPath = process.argv[1];
  if (argvPath === undefined) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(resolve(argvPath)) === realpathSync(modulePath);
  } catch {
    return resolve(argvPath) === modulePath;
  }
}

if (detectMainModule()) {
  run();
}
