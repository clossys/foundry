#!/usr/bin/env node
/**
 * CLI presentation for grounding, strategy records and surface checks.
 * The default and ground modes read dated findings; wont-claim selects the
 * active Proof and Voice using tree.json. Legacy explicit modes remain until
 * their scheduled removal. Exit 0 means clean, 1 means findings, and 2 means
 * input or scan coverage was insufficient to run the check.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkBrandCoverage,
  validateBrandDerivations,
  type BrandCoverageResult,
  type BrandDerivation,
} from "./brand-derivation.js";
import { BRAND_CSS_SEGMENTS, extractBrandCssSlots } from "./brand-css.js";
import { copyEntriesFromRegistry, readBrandFacts, type CopyEntryLike } from "./brand-facts.js";
import { checkBrandFactsDrift, type BrandFactsDriftResult } from "./brand-facts-drift.js";
import { checkBrandSurfaces } from "./brand-surfaces.js";
import {
  checkDirectionCoverage,
  checkDirectionCurrency,
  type DirectionCoverageResult,
  type DirectionCurrencyResult,
} from "./direction-invalidation.js";
import { checkFactsTraceability, type FactsGateResult } from "./facts-gate.js";
import { checkStrategyHandoff, strategyDirectoryUnreadable } from "./handoff.js";
import { checkStrategyApply } from "./markers-gate.js";
import { readGroundRoot } from "./ground/read.js";
import { readStrategyRoot } from "./store.js";
import type { GroundEvidence } from "./fact-index.js";
import { readStrategyDirectory } from "./facts-dir.js";
import { readStrategy } from "./reader.js";
import { validateDirectionEntities, type DirectionEntity } from "./schema.js";
import { DEFAULT_SKIP_DIRS, scanStrategyDirectory } from "./scan.js";
import {
  CURRENT_STRATEGY_DIR_SEGMENTS,
  LEGACY_STRATEGY_DIR_SEGMENTS,
  resolveDefaultStrategyDirectory,
} from "./strategy-dir-default.js";
import { checkWontClaimDrift, type WontClaimResult } from "./wont-claim-drift.js";
import { executeBriefCommand } from "./cli/brief.js";
import { executeChecksCommand } from "./cli/checks.js";
import { isReadCommand, READ_USAGE, runReadCommand } from "./cli/read.js";
import { persistReport } from "./cli/reports.js";

const USAGE = `Usage: strategist-check ground [<strategy-dir>] <scan-dir> [options]
   or: strategist-check <strategy-dir> <scan-dir> [options]
   or: strategist-check brand-coverage <derivations-file> [<brandable-slots-file>]
   or: strategist-check direction <direction-entities-file> <reviewed-against-file>
   or: strategist-check handoff <strategy-dir>
   or: strategist-check apply <strategy-dir> <scan-dir> [options]
   or: strategist-check brand-facts <strategy-dir> <scan-dir> [options]
   or: strategist-check wont-claim <strategy-dir> <scan-dir> [options]

  strategy-dir   Directory containing findings/*.md. Defaults to ./clossys/strategist; --root overrides it.
  scan-dir       Directory to scan for prose/copy claims. Defaults to the current working directory.

Options:
  --root <dir>        Strategy root (ground and wont-claim).
  --json              Print the result as JSON (ground and wont-claim).
  --help              Print this message and exit 0.
  --facts-dir <dir>   Read facts from a directory tree of per-fact JSON leaves (each leaf a JSON array of Fact — not nested group-object domain files) instead of Markdown findings (legacy explicit input). Walks subdirectories; every file under <dir> must be accounted for (_schema.json meta leaves are skipped). Mutually exclusive with flat facts.json in strategy-dir — exit 2 when both are supplied.
  --extensions <ext>  File extension to scan (repeatable; include the leading dot, e.g. --extensions .md). When none are given, the default set is .md, .mdx, .ts, .tsx, .js, and .jsx.
  --skip-dirs <name>  Directory name to skip during the walk (repeatable). Each name is added to the built-in skip list (node_modules, .git, dist, build, coverage); supplying --skip-dirs does not replace those defaults, so node_modules is never walked accidentally.
  --exclude <glob>    Repo-relative path glob to omit from the scan (repeatable), e.g. **/*.test.ts or **/fixtures/**. Directory-name skips use --skip-dirs instead; --exclude is for file-path patterns tests and fixtures need.
  --surfaces <path>   (apply only) Designer-facing surface file that must cite surface-target constraints (repeatable).

Exit codes: 0 = clean, 1 = at least one finding, 2 = could not run (bad input, missing/invalid findings, nothing matched to scan, or an unreadable directory).

Run "strategist-check brand-coverage --help", "strategist-check direction --help", "strategist-check handoff --help", "strategist-check apply --help", "strategist-check brand-facts --help", or "strategist-check wont-claim --help" for those subcommands' own usage.

${READ_USAGE}
`;

const BRAND_COVERAGE_USAGE = `Usage: strategist-check brand-coverage <derivations-file> [<brandable-slots-file>] [options]

  derivations-file      Path to a JSON file containing an array of BrandDerivation objects (see @clossys/strategist's README, "The brand layer"). Required.
  brandable-slots-file  Path to a JSON file containing an array of brandable token-slot name strings (the thing being checked FOR — e.g. every @example/ui/tokens entry with "brandable: true", collected by the caller since this package never imports tokens). Optional: when omitted, the slots are the custom properties declared in brand/brand.css under the working directory, and that stylesheet is named in the report.

Options:
  --surfaces <path>      Designer-facing surface file that must contain do-not language (repeatable).
  --help                 Print this message and exit 0.

Checks, in both directions, whether derivations-file fully accounts for the slot names brandable-slots-file or brand/brand.css declares. Full N/N slot coverage is necessary, not sufficient for keep — Designer-facing surfaces must still carry explicit do-not language when --surfaces is declared.

Exit codes: 0 = satisfied, 1 = violated (a real coverage gap in either direction, or a surface missing do-not language), 2 = indeterminate (could not run: bad input, missing/unreadable/unparseable/invalid file, zero brandable slots supplied, zero derivations supplied, or a declared --surfaces path is missing).
`;

const DIRECTION_USAGE = `Usage: strategist-check direction <direction-entities-file> <reviewed-against-file>

  direction-entities-file  Path to a JSON file containing an array of DirectionEntity objects (see @clossys/strategist's README, "The direction layer"). Required.
  reviewed-against-file    Path to a JSON file containing an array of strings: one entry per derived artifact, naming the DirectionEntity id that artifact's "reviewedAgainst" points at. Required.

Options:
  --help                   Print this message and exit 0.

Runs BOTH checkDirectionCoverage and checkDirectionCurrency against the same two inputs and reports a single combined result:
  - checkDirectionCoverage: does every direction entity have at least one derived artifact behind it, and does every derived artifact trace to a real direction entity.
  - checkDirectionCurrency: does every derived artifact's reviewedAgainst name a direction-entity version that is not just present, but CURRENT (not superseded) — the check presence alone cannot do. See checkDirectionCurrency's own doc comment (src/direction-invalidation.ts).

Exit codes: 0 = both checks hold on non-empty inputs, 1 = either check found a real violation (a coverage gap, or a dangling/stale reviewedAgainst), 2 = indeterminate (could not run: bad input, missing/unreadable/unparseable/invalid file, zero direction entities supplied, or zero reviewedAgainst entries supplied).
`;

const HANDOFF_USAGE = `Usage: strategist-check handoff <strategy-dir>

  strategy-dir   Directory containing the strategy bundle. Optional — defaults the same way the facts-check subcommand does (./clossys/strategist, falling back to the retired ./strategy, still read in this release — see the top-level usage and this package's CHANGELOG for when it is removed).

Options:
  --help         Print this message and exit 0.

Exit codes: 0 = handoff-ready, 1 = handoff findings, 2 = could not read the directory (missing/invalid facts.json).
`;

const APPLY_USAGE = `Usage: strategist-check apply <strategy-dir> <scan-dir> [options]

  strategy-dir   Directory containing claims.json and constraints.json. Optional — defaults the same way the facts-check subcommand does (./clossys/strategist, falling back to the retired ./strategy, still read in this release — see the top-level usage and this package's CHANGELOG for when it is removed).
  scan-dir       Directory to scan for claim: and constraint: markers. Required.

Options:
  --help              Print this message and exit 0.
  --extensions <ext>  File extension to scan (repeatable).
  --skip-dirs <name>  Directory name to skip during the walk (repeatable).
  --exclude <glob>    Repo-relative path glob to omit from the scan (repeatable).
  --surfaces <path>   Designer-facing surface file for surface-target constraints (repeatable).

Exit codes: 0 = clean, 1 = at least one finding, 2 = could not run.
`;

const BRAND_FACTS_USAGE = `Usage: strategist-check brand-facts <strategy-dir> <scan-dir> [options]

  strategy-dir   Directory containing brand-facts.json.
  scan-dir       Directory to scan for surfaces that restate a brand fact.

Options:
  --help                   Print this message and exit 0.
  --copy-registry <file>   Writer copy registry used to resolve tagline copy ids.
  --extensions <ext>       File extension to scan (repeatable; include the leading dot).
  --skip-dirs <name>       Directory name to skip during the walk (repeatable), added to the built-in skip list.
  --exclude <glob>         Repo-relative path glob to omit (repeatable).

Default extensions are .md, .mdx, .txt, .html, .htm, .json, .yml and .yaml; code files opt in through --extensions. When --copy-registry is not given and ./clossys/writer/copy-registry.json exists, that file is used.

Exit codes: 0 = clean, 1 = drift (at least one scanned surface conflicts with the record), 2 = could not run (brand-facts.json missing/unreadable/invalid, a given copy registry unreadable/invalid, no files scanned, an unreadable directory, taglines recorded with no copy registry available, or bad arguments).
`;

const WONT_CLAIM_USAGE = `Usage: strategist-check wont-claim <strategy-dir> <scan-dir> [options]

  strategy-dir   Directory containing tree.json and the active Proof and Voice cells. Defaults to ./clossys/strategist; --root overrides it.
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
  factsDir?: string;
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
  let factsDir: string | undefined;
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
    if (arg === "--facts-dir") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new CliInputError('--facts-dir requires a directory argument, e.g. --facts-dir ./clossys/strategist/facts');
      }
      factsDir = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--facts-dir=")) {
      const value = arg.slice("--facts-dir=".length);
      if (value.length === 0) {
        throw new CliInputError('--facts-dir requires a directory argument, e.g. --facts-dir ./clossys/strategist/facts');
      }
      factsDir = value;
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

  return { strategyDir, scanDir, factsDir, extensions, skipDirs, excludeGlobs, help };
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
  args.strategyDir ??= join(process.cwd(), ...CURRENT_STRATEGY_DIR_SEGMENTS);
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

function requireFile(label: string, path: string): void {
  if (!existsSync(path)) throw new CliInputError(`${label} "${path}" does not exist`);
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    throw new CliInputError(`cannot read ${label} "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile()) throw new CliInputError(`${label} "${path}" is not a file`);
}

function isExistingDirectory(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolves the `strategy-dir` argument shared by the default facts-check
 * subcommand, `handoff`, and `apply`. An explicit argument always wins
 * outright — no resolution, no notice, exactly today's behavior. Omitted
 * (`undefined`), it falls back to `resolveDefaultStrategyDirectory`
 * (`strategy-dir-default.ts`) anchored at `process.cwd()`: the current
 * `clossys/strategist` convention when present, the retired `strategy`
 * directory alone, still read in this release (printed as a plain-language
 * notice; removal is announced beforehand in this package's CHANGELOG), or
 * a refusal — printed and mapped to exit `2`, this package's
 * usual "could not run" state — when both are present at once. See
 * `strategy-dir-default.ts`'s own doc comment for why a silent pick between
 * the two is refused.
 */
function resolveStrategyDirArgument(explicit: string | undefined): { dir: string } | { exitCode: number } {
  if (explicit !== undefined) {
    return { dir: resolve(explicit) };
  }
  const baseDir = process.cwd();
  const currentDir = join(baseDir, ...CURRENT_STRATEGY_DIR_SEGMENTS);
  const legacyDir = join(baseDir, ...LEGACY_STRATEGY_DIR_SEGMENTS);
  const resolved = resolveDefaultStrategyDirectory(
    currentDir,
    legacyDir,
    isExistingDirectory(currentDir),
    isExistingDirectory(legacyDir),
  );
  if (resolved.reason === "indeterminate") {
    console.error(`\n${resolved.notice}`);
    return { exitCode: 2 };
  }
  if (resolved.reason === "legacy") {
    console.log(resolved.notice);
  }
  return { dir: resolved.dir };
}

/** Grounding reads findings; the explicit legacy --facts-dir mode remains available. */
type LoadedFacts = {
  mode: "findings" | "facts-dir"; facts: GroundEvidence[];
  issues: Array<{ file: string; reason: string; detail: string }>;
};

function readStrategyFacts(strategyDir: string, factsDir: string | undefined): LoadedFacts {
  if (factsDir === undefined) {
    const read = readGroundRoot(strategyDir);
    return { mode: "findings", facts: read.model.findings, issues: read.issues.map(detail => ({ file: "findings/", reason: "invalid-findings", detail })) };
  }
  const result = readStrategyDirectory({ files: readDirectoryFiles(factsDir) });
  return { mode: "facts-dir", facts: result.facts, issues: result.issues };
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

// ---------------------------------------------------------------------
// brand-coverage — the second subcommand. Same shape `main()` below uses
// for `checkFactsTraceability`: parse argv, load inputs, run the pure
// check, print a report, pick an exit code from the same 0/1/2 contract.
// ---------------------------------------------------------------------

interface BrandCoverageArgs {
  derivationsFile?: string;
  brandableSlotsFile?: string;
  surfacePaths: string[];
  help: boolean;
}

function parseBrandCoverageArgs(argv: string[]): BrandCoverageArgs {
  let derivationsFile: string | undefined;
  let brandableSlotsFile: string | undefined;
  const surfacePaths: string[] = [];
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--surfaces") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("-")) throw new CliInputError("--surfaces requires a path argument");
      surfacePaths.push(value);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    }
    if (derivationsFile === undefined) {
      derivationsFile = arg;
    } else if (brandableSlotsFile === undefined) {
      brandableSlotsFile = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { derivationsFile, brandableSlotsFile, surfacePaths, help };
}

type JsonReadResult = { ok: true; value: unknown } | { ok: false; detail: string };

/**
 * Reads and JSON-parses a file, never throwing: an I/O failure or a JSON
 * syntax error is returned as `{ ok: false, detail }` — this CLI is the
 * one place in this package that reads either input file off disk, since
 * `checkBrandCoverage` itself is pure, no I/O (see `brand-derivation.ts`'s
 * own doc comment).
 */
function readJsonFile(label: string, path: string): JsonReadResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return { ok: false, detail: `cannot read ${label} "${path}": ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, detail: `${label} "${path}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

type BrandableSlotsReadResult = { ok: true; value: string[] } | { ok: false; detail: string };

/** `brandable-slots-file` must be a JSON array of non-empty strings — the plain slot-name list `checkBrandCoverage` takes as `brandableSlots`. Any other shape is "could not run", never a silently-empty list. */
function readBrandableSlots(path: string): BrandableSlotsReadResult {
  const parsed = readJsonFile("brandable-slots-file", path);
  if (!parsed.ok) return parsed;
  const { value } = parsed;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) {
    return {
      ok: false,
      detail: `brandable-slots-file "${path}" must be a JSON array of non-empty strings, got ${JSON.stringify(value)}.`,
    };
  }
  return { ok: true, value };
}

function printBrandCoverageReport(result: BrandCoverageResult, slotsSource: string): void {
  console.log(`${result.slotsChecked} brandable slot(s) checked against ${result.derivationsChecked} derivation(s).`);
  if (result.slotsMissingDerivation.length > 0) {
    console.log(`${result.slotsMissingDerivation.length} brandable slot(s) named by no derivation:`);
    for (const slot of result.slotsMissingDerivation) console.log(`  ${slot}`);
  }
  if (result.unknownSlotsInDerivations.length > 0) {
    console.log(`${result.unknownSlotsInDerivations.length} derivation-named slot(s) not in ${slotsSource}:`);
    for (const slot of result.unknownSlotsInDerivations) console.log(`  ${slot}`);
  }
  if (result.ok) {
    console.log("Brand coverage: satisfied (slot N/N is necessary, not sufficient for keep).");
  } else if (result.reason === "coverage-gap") {
    console.log("Brand coverage: violated.");
  } else {
    console.log(`Brand coverage: indeterminate (${result.reason}).`);
  }
}

/**
 * `brand-coverage`'s own `main`-equivalent: parse argv, load the two JSON
 * files, run `checkBrandCoverage`, print a report, pick an exit code — the
 * identical shape `main()` below uses for `checkFactsTraceability`,
 * projected onto this gate's own three-state result.
 *
 * A file that is missing/unreadable/unparseable/schema-invalid never
 * reaches `checkBrandCoverage` at all: it is "could not run" (exit `2`),
 * decided and reported here, before the pure check function is ever
 * called. `checkBrandCoverage` itself only ever sees a real `string[]` and
 * a real `BrandDerivation[]`; its own `"no-slots-provided"`/
 * `"no-derivations-provided"` indeterminate reasons are for a run that
 * loaded cleanly but had nothing to compare — those also map to `2` below,
 * never `0` and never conflated with a real `1` violation. This is the
 * ternary the task brief calls out explicitly: both directions hold on
 * non-empty lists is `0`; a real gap is `1`; either list empty, or a file
 * unreadable/unparseable, is `2` — never `1`, never `0`.
 */
function runBrandCoverage(argv: string[]): number {
  const args = parseBrandCoverageArgs(argv);
  if (args.help) {
    console.log(BRAND_COVERAGE_USAGE);
    return 0;
  }
  if (!args.derivationsFile) {
    throw new CliInputError("derivations-file is required");
  }

  const derivationsFile = resolve(args.derivationsFile);
  requireFile("derivations-file", derivationsFile);
  console.log(`Derivations file: ${derivationsFile}`);

  let slotsRead: BrandableSlotsReadResult;
  let slotsSource: string;
  if (args.brandableSlotsFile) {
    const brandableSlotsFile = resolve(args.brandableSlotsFile);
    requireFile("brandable-slots-file", brandableSlotsFile);
    console.log(`Brandable slots file: ${brandableSlotsFile}`);
    slotsRead = readBrandableSlots(brandableSlotsFile);
    slotsSource = "brandable-slots-file";
  } else {
    const brandCssFile = resolve(process.cwd(), ...BRAND_CSS_SEGMENTS);
    if (!existsSync(brandCssFile)) {
      throw new CliInputError(
        `brand/brand.css "${brandCssFile}" does not exist; it is the default when brandable-slots-file is omitted, so create it or pass a brandable-slots-file`,
      );
    }
    requireFile("brand/brand.css", brandCssFile);
    console.log(`Brand stylesheet: ${brandCssFile}`);
    slotsRead = { ok: true, value: extractBrandCssSlots(readFileSync(brandCssFile, "utf8")) };
    slotsSource = BRAND_CSS_SEGMENTS.join("/");
  }
  if (!slotsRead.ok) {
    console.error(`\nBrandable slots could not be loaded: ${slotsRead.detail}`);
    console.error("Refusing to report a pass with no trustworthy brandable-slot list to check against.");
    return 2;
  }

  const derivationsJson = readJsonFile("derivations-file", derivationsFile);
  if (!derivationsJson.ok) {
    console.error(`\nDerivations could not be loaded: ${derivationsJson.detail}`);
    console.error("Refusing to report a pass with no trustworthy derivations to check against.");
    return 2;
  }

  const shape = validateBrandDerivations(derivationsJson.value);
  if (!shape.ok) {
    console.error(`\nDerivations file "${derivationsFile}" is not a valid BrandDerivation[]:`);
    for (const issue of shape.issues) console.error(`  ${issue.path}: ${issue.message}`);
    console.error("Refusing to report a pass with no trustworthy derivations to check against.");
    return 2;
  }
  const derivations: BrandDerivation[] = shape.value;

  const result = checkBrandCoverage(slotsRead.value, derivations);
  printBrandCoverageReport(result, slotsSource);

  const surfaceTexts: { path: string; text: string }[] = [];
  for (const surfacePath of args.surfacePaths) {
    const resolved = resolve(surfacePath);
    if (!existsSync(resolved)) {
      console.error(`\nDeclared surface "${resolved}" does not exist.`);
      return 2;
    }
    try {
      surfaceTexts.push({ path: resolved, text: readFileSync(resolved, "utf8") });
    } catch (error) {
      console.error(`\nDeclared surface "${resolved}" could not be read: ${error instanceof Error ? error.message : String(error)}`);
      return 2;
    }
  }
  const surfaceFindings = checkBrandSurfaces(surfaceTexts);
  if (args.surfacePaths.length > 0) {
    if (surfaceFindings.length > 0) {
      console.log(`\n${surfaceFindings.length} Designer-readable brand law finding(s):`);
      for (const f of surfaceFindings) console.log(`  [${f.rule}] ${f.path}  ${f.message}`);
      console.log("Designer-readable brand law: violated.");
    } else {
      console.log("\nDesigner-readable brand law: satisfied (do-not language on declared surfaces).");
    }
  }

  // Same fail-closed mapping `main()` below uses for the facts gate,
  // restated for this gate's own three-state result: an indeterminate
  // reason (nothing meaningful was compared) is `2`, never `0` and never
  // conflated with a real `1` violation.
  if (!result.ok && result.reason !== "coverage-gap") return 2;
  if (surfaceFindings.length > 0) return 1;
  return result.ok ? 0 : 1;
}

// ---------------------------------------------------------------------
// direction — the third subcommand. Same shape as `brand-coverage` above:
// parse argv, load two JSON files, run the pure checks, print a report,
// pick an exit code from the same 0/1/2 contract. Unlike `brand-coverage`,
// TWO pure checkers run against the SAME pair of loaded inputs
// (`checkDirectionCoverage` and `checkDirectionCurrency` — see
// `direction-invalidation.ts`'s header comment for why they are two
// functions, not one) and this subcommand reports a single combined exit
// code across both.
// ---------------------------------------------------------------------

interface DirectionArgs {
  entitiesFile?: string;
  reviewedAgainstFile?: string;
  help: boolean;
}

function parseDirectionArgs(argv: string[]): DirectionArgs {
  let entitiesFile: string | undefined;
  let reviewedAgainstFile: string | undefined;
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    }
    if (entitiesFile === undefined) {
      entitiesFile = arg;
    } else if (reviewedAgainstFile === undefined) {
      reviewedAgainstFile = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { entitiesFile, reviewedAgainstFile, help };
}

type ReviewedAgainstReadResult = { ok: true; value: string[] } | { ok: false; detail: string };

/** `reviewed-against-file` must be a JSON array of non-empty strings — same shape discipline `readBrandableSlots` applies to `brandable-slots-file`. Any other shape is "could not run", never a silently-empty list. */
function readReviewedAgainst(path: string): ReviewedAgainstReadResult {
  const parsed = readJsonFile("reviewed-against-file", path);
  if (!parsed.ok) return parsed;
  const { value } = parsed;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) {
    return {
      ok: false,
      detail: `reviewed-against-file "${path}" must be a JSON array of non-empty strings, got ${JSON.stringify(value)}.`,
    };
  }
  return { ok: true, value };
}

function printDirectionCoverageReport(result: DirectionCoverageResult): void {
  console.log(
    `${result.entitiesChecked} direction entit${result.entitiesChecked === 1 ? "y" : "ies"} checked against ${result.derivedArtifactsChecked} reviewedAgainst reference(s) (coverage).`,
  );
  if (result.entitiesWithoutDerivedArtifact.length > 0) {
    console.log(
      `${result.entitiesWithoutDerivedArtifact.length} direction entit${result.entitiesWithoutDerivedArtifact.length === 1 ? "y" : "ies"} with no derived artifact:`,
    );
    for (const id of result.entitiesWithoutDerivedArtifact) console.log(`  ${id}`);
  }
  if (result.untraceableDerivedArtifacts.length > 0) {
    console.log(`${result.untraceableDerivedArtifacts.length} reviewedAgainst reference(s) naming no known direction entity:`);
    for (const ref of result.untraceableDerivedArtifacts) console.log(`  ${ref}`);
  }
  if (result.ok) {
    console.log("Direction coverage: satisfied.");
  } else if (result.reason === "coverage-gap") {
    console.log("Direction coverage: violated.");
  } else {
    console.log(`Direction coverage: indeterminate (${result.reason}).`);
  }
}

function printDirectionCurrencyReport(result: DirectionCurrencyResult): void {
  console.log(
    `${result.entitiesChecked} direction entit${result.entitiesChecked === 1 ? "y" : "ies"} checked against ${result.reviewsChecked} reviewedAgainst reference(s) (currency).`,
  );
  if (result.findings.length > 0) {
    console.log(`${result.findings.length} stale/dangling reviewedAgainst reference(s):`);
    for (const finding of result.findings) {
      const detail = finding.kind === "stale-review" ? `superseded by "${finding.supersededBy}"` : "no such direction entity";
      console.log(`  [${finding.kind}] ${finding.reviewedAgainst} — ${detail}`);
    }
  }
  if (result.ok) {
    console.log("Direction currency: satisfied.");
  } else if (result.reason === "currency-violation") {
    console.log("Direction currency: violated.");
  } else {
    console.log(`Direction currency: indeterminate (${result.reason}).`);
  }
}

/**
 * `direction`'s own `main`-equivalent: parse argv, load the two JSON
 * files once, run BOTH `checkDirectionCoverage` and `checkDirectionCurrency`
 * against the identical loaded inputs, print both reports, pick ONE
 * combined exit code — the identical shape `runBrandCoverage` above uses
 * for `checkBrandCoverage`, doubled because this subcommand wires two
 * checkers instead of one.
 *
 * A file that is missing/unreadable/unparseable/schema-invalid never
 * reaches either checker: it is "could not run" (exit `2`), decided and
 * reported here, before either pure check function is ever called. Given
 * clean input, both checkers run: if EITHER reports an indeterminate
 * reason (nothing meaningful was compared by that checker), the combined
 * result is `2`; otherwise if EITHER reports a real violation
 * (`"coverage-gap"` or `"currency-violation"`), the combined result is
 * `1`; only when both hold is the combined result `0`. `2` takes
 * precedence over `1` so "could not fully check" is never masked by "the
 * part that did run happened to pass".
 */
function runDirection(argv: string[]): number {
  const args = parseDirectionArgs(argv);
  if (args.help) {
    console.log(DIRECTION_USAGE);
    return 0;
  }
  if (!args.entitiesFile) {
    throw new CliInputError("direction-entities-file is required");
  }
  if (!args.reviewedAgainstFile) {
    throw new CliInputError("reviewed-against-file is required");
  }

  const entitiesFile = resolve(args.entitiesFile);
  const reviewedAgainstFile = resolve(args.reviewedAgainstFile);
  requireFile("direction-entities-file", entitiesFile);
  requireFile("reviewed-against-file", reviewedAgainstFile);

  console.log(`Direction entities file: ${entitiesFile}`);
  console.log(`Reviewed-against file: ${reviewedAgainstFile}`);

  const reviewedAgainstRead = readReviewedAgainst(reviewedAgainstFile);
  if (!reviewedAgainstRead.ok) {
    console.error(`\nReviewed-against references could not be loaded: ${reviewedAgainstRead.detail}`);
    console.error("Refusing to report a pass with no trustworthy reviewedAgainst list to check against.");
    return 2;
  }

  const entitiesJson = readJsonFile("direction-entities-file", entitiesFile);
  if (!entitiesJson.ok) {
    console.error(`\nDirection entities could not be loaded: ${entitiesJson.detail}`);
    console.error("Refusing to report a pass with no trustworthy direction entities to check against.");
    return 2;
  }

  const shape = validateDirectionEntities(entitiesJson.value);
  if (!shape.ok) {
    console.error(`\nDirection entities file "${entitiesFile}" is not a valid DirectionEntity[]:`);
    for (const issue of shape.issues) console.error(`  ${issue.path}: ${issue.message}`);
    console.error("Refusing to report a pass with no trustworthy direction entities to check against.");
    return 2;
  }
  const entities: DirectionEntity[] = shape.value;
  const directionIds = entities.map((entity) => entity.id);

  const coverage = checkDirectionCoverage(directionIds, reviewedAgainstRead.value);
  printDirectionCoverageReport(coverage);
  console.log("");
  const currency = checkDirectionCurrency(entities, reviewedAgainstRead.value);
  printDirectionCurrencyReport(currency);

  const coverageIndeterminate = !coverage.ok && coverage.reason !== "coverage-gap";
  const currencyIndeterminate = !currency.ok && currency.reason !== "currency-violation";
  if (coverageIndeterminate || currencyIndeterminate) return 2;
  if (!coverage.ok || !currency.ok) return 1;
  return 0;
}

/**
 * The CLI's own small I/O helper for `--facts-dir`: reads the directory's
 * direct entries into the relative-path -> raw-text map
 * `readStrategyDirectory` consumes. This is the ONLY filesystem call in
 * the --facts-dir path — the directory reader itself stays pure, the same
 * split `scan.ts` (I/O) and `facts-gate.ts` (pure) draw. Mirrors
 * `scanStrategyDirectory`'s fail-closed discipline: an unreadable
 * directory or entry throws (caught by `run()` → exit 2) rather than
 * being silently treated as empty. Subdirectories are walked recursively
 * (same path convention as `scanStrategyDirectory`); `_schema.json` meta
 * leaves at any depth are skipped.
 */
function readDirectoryFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {};

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      throw new CliInputError(
        `cannot read --facts-dir "${dir}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const entry of entries) {
      if (entry === "_schema.json") continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch (error) {
        throw new CliInputError(
          `cannot read --facts-dir entry "${full}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!stat.isFile()) continue;
      const relPath = relative(root, full).split(sep).join("/");
      let raw: string;
      try {
        raw = readFileSync(full, "utf8");
      } catch (error) {
        throw new CliInputError(
          `cannot read --facts-dir entry "${full}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      files[relPath] = raw;
    }
  }

  walk(root);
  return files;
}

function runHandoff(argv: string[]): number {
  let strategyDir: string | undefined;
  let help = false;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) throw new CliInputError(`unknown flag "${arg}"`);
    if (strategyDir === undefined) strategyDir = arg;
    else throw new CliInputError(`unexpected extra argument "${arg}"`);
  }
  if (help) {
    console.log(HANDOFF_USAGE);
    return 0;
  }
  const strategyDirResolution = resolveStrategyDirArgument(strategyDir);
  if ("exitCode" in strategyDirResolution) return strategyDirResolution.exitCode;
  const resolved = strategyDirResolution.dir;
  requireDirectory("strategy-dir", resolved);
  const bundle = readStrategy(resolved);
  if (strategyDirectoryUnreadable(bundle.issues)) {
    console.error("Strategy directory could not be read (facts.json missing or invalid).");
    return 2;
  }
  const result = checkStrategyHandoff(bundle);
  if (result.ok) {
    console.log("Strategy handoff: satisfied.");
    return 0;
  }
  console.log(`Strategy handoff: ${result.findings.length} finding(s):`);
  for (const finding of result.findings) console.log(`  ${finding.message}`);
  return 1;
}

function runApply(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(APPLY_USAGE);
    return 0;
  }
  if (!args.scanDir) throw new CliInputError("scan-dir is required");
  const strategyDirResolution = resolveStrategyDirArgument(args.strategyDir);
  if ("exitCode" in strategyDirResolution) return strategyDirResolution.exitCode;
  const strategyDir = strategyDirResolution.dir;
  const scanDir = resolve(args.scanDir);
  requireDirectory("strategy-dir", strategyDir);
  requireDirectory("scan-dir", scanDir);

  const bundle = readStrategy(strategyDir);
  if (strategyDirectoryUnreadable(bundle.issues)) {
    console.error("Strategy directory could not be read (facts.json missing or invalid).");
    return 2;
  }
  if (bundle.claims === undefined) {
    console.error("claims.json is missing or invalid — cannot check claim markers.");
    return 2;
  }
  if (bundle.constraints === undefined) {
    console.error("constraints.json is missing or invalid — cannot check constraint markers.");
    return 2;
  }

  const scanOptions: { extensions?: string[]; skipDirs?: string[]; excludeGlobs?: string[] } = {};
  if (args.extensions.length > 0) scanOptions.extensions = args.extensions;
  if (args.skipDirs.length > 0) scanOptions.skipDirs = [...DEFAULT_SKIP_DIRS, ...args.skipDirs];
  if (args.excludeGlobs.length > 0) scanOptions.excludeGlobs = args.excludeGlobs;
  const files = scanStrategyDirectory(scanDir, scanOptions);
  if (files.length === 0) {
    console.error(`No files matched under "${scanDir}" — nothing was scanned.`);
    return 2;
  }

  const surfaceFiles: { path: string; content: string }[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--surfaces") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) throw new CliInputError("--surfaces requires a path argument");
      const resolved = resolve(value);
      if (!existsSync(resolved)) throw new CliInputError(`declared surface "${resolved}" does not exist`);
      surfaceFiles.push({ path: resolved, content: readFileSync(resolved, "utf8") });
      i += 1;
      continue;
    }
    if (arg.startsWith("--surfaces=")) {
      const resolved = resolve(arg.slice("--surfaces=".length));
      if (!existsSync(resolved)) throw new CliInputError(`declared surface "${resolved}" does not exist`);
      surfaceFiles.push({ path: resolved, content: readFileSync(resolved, "utf8") });
    }
  }

  const result = checkStrategyApply(files, bundle.claims, bundle.constraints, { surfaceFiles });
  if (result.findings.length === 0) {
    console.log("Strategy apply: satisfied.");
    return 0;
  }
  console.log(`Strategy apply: ${result.findings.length} finding(s):`);
  for (const finding of result.findings) {
    console.log(`  [${finding.rule}] ${finding.file}:${finding.line}  ${finding.message}`);
  }
  return 1;
}

// ---------------------------------------------------------------------
// brand-facts — record-vs-surface drift. Same shape as `apply` above:
// resolve strategy-dir, walk scan-dir, run the pure check, print, exit.
// ---------------------------------------------------------------------

/** Prose, markup, and data files — where brand facts get restated. Code files opt in via --extensions. */
const BRAND_FACTS_DEFAULT_EXTENSIONS = [".md", ".mdx", ".txt", ".html", ".htm", ".json", ".yml", ".yaml"];

/** Where the Writer keeps its copy registry, relative to cwd; used when --copy-registry is not given and it exists. */
const DEFAULT_COPY_REGISTRY_SEGMENTS = ["clossys", "writer", "copy-registry.json"] as const;

/**
 * Pulls `--copy-registry <file>` / `--copy-registry=<file>` out of argv so
 * the remainder can go through the shared `parseArgs` unchanged (which
 * would otherwise refuse the flag as unknown). Given twice is refused —
 * silently preferring one of two registries is the kind of pick this CLI
 * never makes.
 */
function extractCopyRegistryFlag(argv: string[]): { copyRegistry?: string; rest: string[] } {
  let copyRegistry: string | undefined;
  const rest: string[] = [];
  const set = (value: string | undefined): void => {
    if (value === undefined || value.length === 0 || value.startsWith("-")) {
      throw new CliInputError("--copy-registry requires a file argument, e.g. --copy-registry ./clossys/writer/copy-registry.json");
    }
    if (copyRegistry !== undefined) throw new CliInputError("--copy-registry given more than once; supply exactly one");
    copyRegistry = value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--copy-registry") {
      set(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--copy-registry=")) {
      set(arg.slice("--copy-registry=".length));
      continue;
    }
    rest.push(arg);
  }
  return copyRegistry === undefined ? { rest } : { copyRegistry, rest };
}

type CopyRegistryLoad = { ok: true; entries: CopyEntryLike[] | undefined; path?: string } | { ok: false; detail: string };

/**
 * An explicit --copy-registry must load, or the run is "could not run".
 * Without one, the default path is used only when it exists; a default that
 * exists but is unreadable or invalid is refused the same way — it is the
 * registry the operator would expect to be used. No registry at all yields
 * `entries: undefined`, which `checkBrandFactsDrift` itself reports as
 * indeterminate when the record has taglines.
 */
function loadCopyRegistry(explicit: string | undefined): CopyRegistryLoad {
  let path: string;
  if (explicit !== undefined) {
    path = resolve(explicit);
  } else {
    path = join(process.cwd(), ...DEFAULT_COPY_REGISTRY_SEGMENTS);
    if (!existsSync(path)) return { ok: true, entries: undefined };
  }
  const parsed = readJsonFile("copy registry", path);
  if (!parsed.ok) return parsed;
  const shape = copyEntriesFromRegistry(parsed.value);
  if (!shape.ok) {
    const issues = shape.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    return { ok: false, detail: `copy registry "${path}" is not a valid Writer copy registry: ${issues}` };
  }
  return { ok: true, entries: shape.value, path };
}

function printBrandFactsReport(result: BrandFactsDriftResult): void {
  console.log(`Scanned ${result.filesScanned} file${result.filesScanned === 1 ? "" : "s"}.`);
  if (result.ignored.length > 0) {
    console.log(`${result.ignored.length} explicitly ignored via "brand-facts:ignore":`);
    for (const ig of result.ignored) console.log(`  ${ig.file}:${ig.line}  ${ig.snippet}`);
  }
  if (result.findings.length > 0) {
    console.log(`\n${result.findings.length} finding(s):`);
    for (const f of result.findings) console.log(`  [${f.kind}] ${f.file}:${f.line}  ${f.message}`);
  }
  if (result.state === "clean") {
    console.log("Brand facts: clean.");
  } else if (result.state === "drift") {
    console.log("Brand facts: drift.");
  } else {
    console.log("Brand facts: indeterminate.");
    for (const reason of result.indeterminateReasons) console.error(`  ${reason}`);
  }
}

/**
 * `brand-facts`'s own `main`-equivalent. Everything that would make the
 * check unable to speak — a missing/unreadable/invalid record, a copy
 * registry that was asked for (or found) but will not load, zero files
 * matched — is refused here with `2` before the pure check runs. The
 * check's own "indeterminate" state (e.g. taglines recorded with no
 * registry available) also maps to `2`, and wins over drift: "could not
 * fully check" is never masked by findings from the part that did run.
 */
function runBrandFacts(argv: string[]): number {
  const { copyRegistry, rest } = extractCopyRegistryFlag(argv);
  const args = parseArgs(rest);
  if (args.help) {
    console.log(BRAND_FACTS_USAGE);
    return 0;
  }
  if (args.factsDir !== undefined) throw new CliInputError('unknown flag "--facts-dir" for brand-facts');
  if (!args.scanDir) throw new CliInputError("scan-dir is required");
  const strategyDirResolution = resolveStrategyDirArgument(args.strategyDir);
  if ("exitCode" in strategyDirResolution) return strategyDirResolution.exitCode;
  const strategyDir = strategyDirResolution.dir;
  const scanDir = resolve(args.scanDir);
  requireDirectory("strategy-dir", strategyDir);
  requireDirectory("scan-dir", scanDir);

  console.log(`Strategy directory: ${strategyDir}`);
  console.log(`Scan directory: ${scanDir}`);

  const read = readBrandFacts(strategyDir);
  if (read.status !== "ok") {
    const detail = read.status === "missing" ? read.detail : `${read.issue.reason}: ${read.issue.detail}`;
    console.error(`\nBrand facts could not be loaded (${detail}).`);
    console.error("Refusing to report a pass with no trustworthy brand-facts record to check surfaces against.");
    return 2;
  }

  const registry = loadCopyRegistry(copyRegistry);
  if (!registry.ok) {
    console.error(`\nCopy registry could not be loaded: ${registry.detail}`);
    console.error("Refusing to report a pass with no trustworthy copy registry to resolve taglines against.");
    return 2;
  }
  console.log(`Copy registry: ${registry.path ?? "(none)"}`);

  const scanOptions: { extensions: string[]; skipDirs?: string[]; excludeGlobs?: string[] } = {
    extensions: args.extensions.length > 0 ? args.extensions : BRAND_FACTS_DEFAULT_EXTENSIONS,
  };
  if (args.skipDirs.length > 0) scanOptions.skipDirs = [...DEFAULT_SKIP_DIRS, ...args.skipDirs];
  if (args.excludeGlobs.length > 0) scanOptions.excludeGlobs = args.excludeGlobs;
  const files = scanStrategyDirectory(scanDir, scanOptions); // throws (fail-closed) on an unreadable directory — caught by run()
  if (files.length === 0) {
    console.error(`\nNo files matched under "${scanDir}" — nothing was scanned.`);
    console.error("Refusing to report a pass for a scan that checked nothing.");
    return 2;
  }

  const result = checkBrandFactsDrift(
    files,
    read.facts,
    registry.entries === undefined ? {} : { copyEntries: registry.entries },
  );
  printBrandFactsReport(result);
  if (result.state === "indeterminate") {
    console.error("Refusing to report a pass for a check that could not run in full.");
    return 2;
  }
  return result.state === "drift" ? 1 : 0;
}

// ---------------------------------------------------------------------
// wont-claim — active Proof and Voice vs surfaces. Same shape as `brand-facts`
// above, without a copy registry.
// ---------------------------------------------------------------------

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
  if (args.factsDir !== undefined) throw new CliInputError('unknown flag "--facts-dir" for wont-claim');
  if (!args.scanDir) throw new CliInputError("scan-dir is required");
  const strategyDirResolution = resolveStrategyDirArgument(args.strategyDir);
  if ("exitCode" in strategyDirResolution) return strategyDirResolution.exitCode;
  const strategyDir = strategyDirResolution.dir;
  const scanDir = resolve(args.scanDir);
  requireDirectory("strategy-dir", strategyDir);
  requireDirectory("scan-dir", scanDir);

  if (!args.json) console.log(`Strategy directory: ${strategyDir}`);
  if (!args.json) console.log(`Scan directory: ${scanDir}`);

  const model = readStrategyRoot(strategyDir);

  const scanOptions: { extensions: string[]; skipDirs?: string[]; excludeGlobs?: string[] } = {
    extensions: args.extensions.length > 0 ? args.extensions : BRAND_FACTS_DEFAULT_EXTENSIONS,
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
  if (isReadCommand(argv)) {
    return runReadCommand(argv, { execute: args => args.command === "brief" || args.command === "handoff" ? executeBriefCommand(args) : executeChecksCommand(args) });
  }
  if (argv[0] === "brand-coverage") {
    return runBrandCoverage(argv.slice(1));
  }
  if (argv[0] === "direction") {
    return runDirection(argv.slice(1));
  }
  if (argv[0] === "handoff") {
    return runHandoff(argv.slice(1));
  }
  if (argv[0] === "apply") {
    return runApply(argv.slice(1));
  }
  if (argv[0] === "brand-facts") {
    return runBrandFacts(argv.slice(1));
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
  if ("exitCode" in strategyDirResolution) return strategyDirResolution.exitCode;
  const strategyDir = strategyDirResolution.dir;
  const scanDir = resolve(args.scanDir ?? process.cwd());
  requireDirectory("strategy-dir", strategyDir);
  requireDirectory("scan-dir", scanDir);

  // The two facts sources are mutually exclusive by contract: --facts-dir
  // REPLACES the flat facts.json as the gate's ground truth, and silently
  // preferring one of two simultaneously supplied registries would let a
  // run pass against facts the operator believed were superseded. Refused
  // before anything runs, naming the conflict, at exit code 2 — the same
  // "could not run" third state as every other bad input.
  let factsDir: string | undefined;
  if (args.factsDir !== undefined) {
    factsDir = resolve(args.factsDir);
    requireDirectory("--facts-dir", factsDir);
    const flatFactsPath = join(strategyDir, "facts.json");
    if (existsSync(flatFactsPath)) {
      throw new CliInputError(
        `--facts-dir "${factsDir}" and facts.json "${flatFactsPath}" are mutually exclusive facts sources; supply exactly one — remove --facts-dir to use the flat file, or point strategy-dir somewhere without a facts.json`,
      );
    }
  }

  if (!args.json) console.log(`Strategy directory: ${strategyDir}`);
  if (factsDir !== undefined && !args.json) {
    console.log(`Facts directory: ${factsDir} (flat facts.json not used)`);
  }
  if (!args.json) console.log(`Scan directory: ${scanDir}`);

  const loaded = readStrategyFacts(strategyDir, factsDir);
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
  const result = checkFactsTraceability(surfaces, facts);
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
