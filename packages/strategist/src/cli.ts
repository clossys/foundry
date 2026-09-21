#!/usr/bin/env node
/**
 * `strategist-check` — the CLI for `checkFactsTraceability`. Presentation
 * only: parse argv, read the strategy directory, walk the scan directory,
 * run the pure gate, print a report, pick an exit code. All real work
 * happens in `reader.ts`, `scan.ts`, and `facts-gate.ts`.
 *
 * A second subcommand, `brand-coverage`, wires `checkBrandCoverage`
 * (`./brand-derivation.ts`) in with the identical shape: parse argv, load
 * two JSON files, run the pure check, print a report, pick an exit code
 * from the same 0/1/2 contract — see `runBrandCoverage`'s own doc comment
 * below. This mirrors `@example/copy`'s `copy-check
 * voice-derivation-coverage` subcommand exactly. `main()` dispatches to it
 * only when `argv[0]` is exactly `"brand-coverage"`; any other first
 * argument (including every existing caller's real `strategy-dir` path)
 * falls through to the original, unchanged behavior below — this addition
 * is purely additive to the argv contract, checked BEFORE the existing
 * `parseArgs` call so no pre-existing test needs to change.
 *
 * Exit codes — a contract a consumer's CI depends on, matching this
 * repository's `foundry-check` convention (`@example/gates`):
 *
 *   0 — ran cleanly, facts.json loaded, at least one file scanned, zero findings.
 *   1 — ran cleanly, at least one finding (an untraced claim or a citation to a fact key that does not exist).
 *   2 — could not run: bad input, facts.json missing/unreadable/invalid, the
 *       scan matched zero files, an unreadable directory during the walk, or
 *       an unexpected exception. Kept strictly distinct from 1 — a gate
 *       that reports "clean" after failing to run is worse than no gate at
 *       all. This is the explicit third state this gate is built around:
 *       "could not check" must never be reported as a pass.
 *
 * `brand-coverage` uses the same three-state contract, projected onto
 * `checkBrandCoverage`'s own result: `0` both directions hold on non-empty
 * lists, `1` a real coverage gap in either direction, `2` indeterminate —
 * either input list empty, or a file missing/unreadable/unparseable/
 * invalid. See `runBrandCoverage` below for the exact mapping.
 *
 * A third subcommand, `direction`, wires `checkDirectionCoverage` AND
 * `checkDirectionCurrency` (`./direction-invalidation.ts`) in with the
 * identical shape again: parse argv, load two JSON files, run both pure
 * checks, print a combined report, pick a single exit code from the same
 * 0/1/2 contract — see `runDirection`'s own doc comment below. Dispatched
 * only when `argv[0]` is exactly `"direction"`, checked BEFORE the
 * existing `parseArgs` call and alongside the `brand-coverage` check —
 * every other first argument, including `brand-coverage` itself and any
 * real `strategy-dir` path, still falls through unchanged.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkBrandCoverage,
  validateBrandDerivations,
  type BrandCoverageResult,
  type BrandDerivation,
} from "./brand-derivation.js";
import { checkBrandSurfaces } from "./brand-surfaces.js";
import {
  checkDirectionCoverage,
  checkDirectionCurrency,
  type DirectionCoverageResult,
  type DirectionCurrencyResult,
} from "./direction-invalidation.js";
import { checkFactsTraceability, type FactsGateResult } from "./facts-gate.js";
import { readStrategyDirectory } from "./facts-dir.js";
import { readStrategy, type StrategyBundle } from "./reader.js";
import { validateDirectionEntities, type DirectionEntity, type Fact } from "./schema.js";
import { scanStrategyDirectory } from "./scan.js";

const USAGE = `Usage: strategist-check <strategy-dir> [scan-dir] [options]
   or: strategist-check brand-coverage <derivations-file> <brandable-slots-file>
   or: strategist-check direction <direction-entities-file> <reviewed-against-file>

  strategy-dir   Directory containing facts.json (and the rest of the strategy bundle). Required.
  scan-dir       Directory to scan for prose/copy claims. Defaults to the current working directory.

Options:
  --help              Print this message and exit 0.
  --facts-dir <dir>   Read facts from a directory of per-fact JSON files (each leaf a JSON array of Fact, e.g. one file per fact) instead of the strategy directory's flat facts.json. The rest of the strategy bundle (mission.json, roadmap.json, ...) is not read in this mode. Mutually exclusive with the flat facts.json: a facts.json present in strategy-dir alongside --facts-dir is refused — exit 2, naming the conflict.

Exit codes: 0 = clean, 1 = at least one finding, 2 = could not run (bad input, missing/invalid facts.json, nothing matched to scan, or an unreadable directory).

Run "strategist-check brand-coverage --help" or "strategist-check direction --help" for those subcommands' own usage.
`;

const BRAND_COVERAGE_USAGE = `Usage: strategist-check brand-coverage <derivations-file> <brandable-slots-file> [options]

  derivations-file      Path to a JSON file containing an array of BrandDerivation objects (see @clossys/strategist's README, "The brand layer"). Required.
  brandable-slots-file  Path to a JSON file containing an array of brandable token-slot name strings (the thing being checked FOR — e.g. every @example/ui/tokens entry with "brandable: true", collected by the caller since this package never imports tokens). Required.

Options:
  --surfaces <path>      Designer-facing surface file that must contain do-not language (repeatable).
  --help                 Print this message and exit 0.

Checks, in both directions, whether derivations-file fully accounts for the slot names brandable-slots-file declares. Full N/N slot coverage is necessary, not sufficient for keep — Designer-facing surfaces must still carry explicit do-not language when --surfaces is declared.

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

/** Exported for `cli.test.ts` — anything wrong with the arguments themselves always maps to exit code 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  strategyDir?: string;
  scanDir?: string;
  factsDir?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let strategyDir: string | undefined;
  let scanDir: string | undefined;
  let factsDir: string | undefined;
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
        throw new CliInputError('--facts-dir requires a directory argument, e.g. --facts-dir ./strategy/facts');
      }
      factsDir = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--facts-dir=")) {
      const value = arg.slice("--facts-dir=".length);
      if (value.length === 0) {
        throw new CliInputError('--facts-dir requires a directory argument, e.g. --facts-dir ./strategy/facts');
      }
      factsDir = value;
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

  return { strategyDir, scanDir, factsDir, help };
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

/**
 * The facts half of a strategy bundle, as `main()` consumes it: either the
 * full `readStrategy` bundle (flat facts.json) or the facts-only directory
 * read (`--facts-dir`), normalized to the two things the gate needs. The
 * union issue shape keeps the CLI's reporting and fail-closed mapping
 * identical across both modes.
 */
type LoadedFacts =
  | { mode: "bundle"; bundle: StrategyBundle; facts: Fact[]; issues: Array<{ file: string; reason: string; detail: string }> }
  | { mode: "facts-dir"; facts: Fact[]; issues: Array<{ file: string; reason: string; detail: string }> };

/**
 * Loads facts for the gate in exactly one of the two mutually exclusive
 * modes. A directory with a failing leaf is recorded, never thrown —
 * `main()` maps those issues to exit code 2 below, the same fail-closed
 * route a bad flat facts.json takes.
 */
function readStrategyFacts(strategyDir: string, factsDir: string | undefined): LoadedFacts {
  if (factsDir === undefined) {
    const bundle = readStrategy(strategyDir);
    return { mode: "bundle", bundle, facts: bundle.facts, issues: bundle.issues };
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

function printBrandCoverageReport(result: BrandCoverageResult): void {
  console.log(`${result.slotsChecked} brandable slot(s) checked against ${result.derivationsChecked} derivation(s).`);
  if (result.slotsMissingDerivation.length > 0) {
    console.log(`${result.slotsMissingDerivation.length} brandable slot(s) named by no derivation:`);
    for (const slot of result.slotsMissingDerivation) console.log(`  ${slot}`);
  }
  if (result.unknownSlotsInDerivations.length > 0) {
    console.log(`${result.unknownSlotsInDerivations.length} derivation-named slot(s) not in brandable-slots-file:`);
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
  if (!args.brandableSlotsFile) {
    throw new CliInputError("brandable-slots-file is required");
  }

  const derivationsFile = resolve(args.derivationsFile);
  const brandableSlotsFile = resolve(args.brandableSlotsFile);
  requireFile("derivations-file", derivationsFile);
  requireFile("brandable-slots-file", brandableSlotsFile);

  console.log(`Derivations file: ${derivationsFile}`);
  console.log(`Brandable slots file: ${brandableSlotsFile}`);

  const slotsRead = readBrandableSlots(brandableSlotsFile);
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
  printBrandCoverageReport(result);

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
  if (surfaceFindings.length > 0) {
    console.log(`\n${surfaceFindings.length} surface finding(s):`);
    for (const f of surfaceFindings) console.log(`  [${f.rule}] ${f.path}  ${f.message}`);
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
 * being silently treated as empty, and subdirectories are not descended
 * into — a facts directory is one flat registry of leaves.
 */
function readDirectoryFiles(dir: string): Record<string, string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    throw new CliInputError(`cannot read --facts-dir "${dir}": ${error instanceof Error ? error.message : String(error)}`);
  }
  const files: Record<string, string> = {};
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch (error) {
      throw new CliInputError(`cannot read --facts-dir entry "${full}": ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!stat.isFile()) {
      throw new CliInputError(`--facts-dir entry "${entry}" is not a file — a facts directory is one flat registry of leaves, no subdirectories`);
    }
    let raw: string;
    try {
      raw = readFileSync(full, "utf8");
    } catch (error) {
      throw new CliInputError(`cannot read --facts-dir entry "${full}": ${error instanceof Error ? error.message : String(error)}`);
    }
    files[entry] = raw;
  }
  return files;
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
  // Subcommand dispatch: only `argv[0] === "brand-coverage"` or
  // `argv[0] === "direction"` exactly diverts to the second/third
  // subcommand — see this file's top-of-file doc comment. Every other
  // first argument, including any real `strategy-dir` path an existing
  // caller already passes, falls straight through to the original
  // behavior below, unchanged. Checked BEFORE `parseArgs` so no
  // pre-existing argv shape can be reinterpreted.
  if (argv[0] === "brand-coverage") {
    return runBrandCoverage(argv.slice(1));
  }
  if (argv[0] === "direction") {
    return runDirection(argv.slice(1));
  }

  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.strategyDir) {
    throw new CliInputError("strategy-dir is required");
  }

  const strategyDir = resolve(args.strategyDir);
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

  console.log(`Strategy directory: ${strategyDir}`);
  if (factsDir !== undefined) {
    console.log(`Facts directory: ${factsDir} (flat facts.json not used)`);
  }
  console.log(`Scan directory: ${scanDir}`);

  const loaded = readStrategyFacts(strategyDir, factsDir);
  const issues = loaded.issues;
  if (issues.length > 0 && loaded.mode === "bundle") {
    console.log(`\n${issues.length} strategy file issue(s):`);
    for (const issue of issues) {
      console.log(`  [${issue.reason}] ${issue.file}: ${issue.detail}`);
    }
  } else if (issues.length > 0) {
    console.log(`\n${issues.length} facts directory issue(s):`);
    for (const issue of issues) {
      console.log(`  [${issue.reason}] ${issue.file}: ${issue.detail}`);
    }
  }

  // The gate has exactly one trustworthy ground truth, whichever mode
  // supplied it. Any issue at all in --facts-dir mode is fail-closed —
  // there is no notion of optional files there, so a refused leaf (bad
  // JSON, schema violation, a non-JSON file, an empty directory) is never
  // reported as a clean pass. Flat mode keeps its narrower rule: only a
  // facts.json issue blocks; an issue on some OTHER optional strategy file
  // (mission.json, roadmap.json, ...) does not, because the facts gate
  // only ever needs facts.
  const factsIssue = loaded.mode === "bundle" ? issues.find((i) => i.file === "facts.json") : issues[0];
  if (factsIssue) {
    console.error(`\nFacts could not be loaded (${factsIssue.reason}: ${factsIssue.detail}).`);
    console.error("Refusing to report a pass with no trustworthy facts to check prose against.");
    return 2;
  }

  const facts = loaded.facts;

  const files = scanStrategyDirectory(scanDir); // throws (fail-closed) on an unreadable directory — caught by run()

  // Zero files matched is the exact failure mode this gate is built to
  // never silently pass: "nothing to scan" is not the same thing as "scanned
  // everything, found nothing wrong" — see the package README.
  if (files.length === 0) {
    console.error(`\nNo files matched under "${scanDir}" — nothing was scanned.`);
    console.error("Refusing to report a pass for a scan that checked nothing.");
    return 2;
  }

  const result = checkFactsTraceability(files, facts);
  printReport(result);

  return result.findings.length > 0 ? 1 : 0;
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
