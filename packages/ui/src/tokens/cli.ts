#!/usr/bin/env node
/**
 * `tokens-brand-check` — the CLI for `checkBrandFileCoverage`. Presentation
 * only: parse argv, read the brand CSS file (`read-brand-css.ts`), run the
 * pure gate (`check-brand-file-coverage.ts`), print a report — every
 * uncovered/typo/non-brandable finding AND every unparseable region, never
 * just a pass/fail line — and pick an exit code. Matches
 * `@vespeneventures/copy`'s `copy-check` and `@vespeneventures/strategy`'s
 * `strategy-facts-check` shape deliberately: same three-state exit-code
 * contract, same `--help`, same `CliInputError` split between "bad
 * arguments" and "ran, found something wrong".
 *
 * Exit codes — a contract a consumer's CI depends on, matching this
 * repository's `foundry-check` convention (`@vespeneventures/gates`):
 *
 *   0 — ran cleanly: the brand CSS file was read, every declaration in it
 *       was classified (no `unchecked` region at the file-reader level or
 *       the check level), zero findings.
 *   1 — ran cleanly, at least one finding (an uncovered brandable slot, an
 *       unknown/typo'd slot name, or an override of a non-brandable slot).
 *   2 — could not run: bad input, the brand CSS file missing/unreadable, OR
 *       — the same discipline `copy-check` holds `ScanResult.unchecked` to
 *       — at least one region of the file this reader recognized as
 *       CSS-shaped but could not resolve into a real declaration, OR a
 *       `declarations` key `checkBrandFileCoverage` itself could not classify.
 *       Kept strictly distinct from `1`: a gate that reports "clean" after
 *       failing to fully read a file is worse than no gate at all. This is
 *       the explicit third state this gate is built around: "could not
 *       check" must never be reported as a pass. Every finding this run DID
 *       produce is still printed before returning `2` — an unparsed region
 *       does not hide what WAS learned about the rest of the file.
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBrandFileCoverage, type BrandFileCoverageReport } from "./check-brand-file-coverage.js";
import { readBrandCss, type BrandCssReadResult } from "./read-brand-css.js";

const USAGE = `Usage: tokens-brand-check <brand-css-file> [options]

  brand-css-file   Path to a brand CSS file (e.g. your project's brand.css, started from @vespeneventures/ui/brand-template.css). Required.

Options:
  --help         Print this message and exit 0.

Exit codes: 0 = clean, 1 = at least one finding, 2 = could not run (bad input, missing/unreadable file, or a region of the file that could not be parsed).
`;

/** Exported for `cli.test.ts` — anything wrong with the arguments themselves always maps to exit code 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  brandCssFile?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let brandCssFile: string | undefined;
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    }
    if (brandCssFile === undefined) {
      brandCssFile = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { brandCssFile, help };
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
 * Prints every accounting number and every finding/unchecked entry
 * unconditionally, not only when something looks wrong — the same
 * discipline `copy-check`'s `printScanAccounting`/`printGateReport` and
 * `strategy-facts-check`'s `printReport` hold to: a gate that quietly
 * narrows its own coverage and reports the narrowed result as a pass is
 * the exact failure mode this package's brief was written against.
 */
function printReadAccounting(read: BrandCssReadResult): void {
  console.log(`Brand CSS file: ${read.path}`);
  console.log(`${Object.keys(read.declarations).length} custom-property declaration(s) found.`);
  if (read.unchecked.length > 0) {
    console.error(`${read.unchecked.length} region(s) of the file could NOT be parsed as a declaration:`);
    for (const u of read.unchecked) console.error(`  line ${u.line}: ${u.detail}`);
  }
}

function printCoverageReport(result: BrandFileCoverageReport): void {
  console.log(
    `${result.declarationsChecked} declaration(s) checked against ${result.brandableSlotsChecked} brandable token slot(s).`,
  );
  if (result.unchecked.length > 0) {
    console.error(`${result.unchecked.length} declaration key(s) could not be classified:`);
    for (const u of result.unchecked) console.error(`  "${u.key}": ${u.reason}`);
  }
  if (result.findings.length === 0) {
    console.log("No findings.");
    return;
  }
  console.log(`\n${result.findings.length} finding(s):`);
  for (const f of result.findings) {
    console.log(`  [${f.rule}] ${f.slot}  ${f.message}`);
  }
}

/**
 * Exported (unlike a typical CLI `main`) so `cli.test.ts` can exercise the
 * whole argv-to-exit-code contract directly, against real `mkdtemp` temp
 * files, without spawning a subprocess for every case. Takes `argv` as a
 * parameter rather than reading `process.argv` itself for exactly that
 * reason — `run()` below is the only caller that reads the real
 * `process.argv`.
 */
export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.brandCssFile) {
    throw new CliInputError("brand-css-file is required");
  }

  const path = resolve(args.brandCssFile);
  requireFile("brand-css-file", path);

  const read = readBrandCss(path);

  // The file itself missing/unreadable is fail-closed: there is nothing
  // trustworthy to check at all, so this is "could not run", never a clean
  // pass produced from zero declarations — the same discipline
  // `copy-check`/`strategy-facts-check` hold their own required input file
  // to.
  if (!read.complete) {
    console.error(`\nBrand CSS file could not be read:`);
    for (const issue of read.issues) console.error(`  [${issue.reason}] ${issue.detail}`);
    console.error("Refusing to report a pass with no trustworthy brand CSS to check.");
    return 2;
  }

  printReadAccounting(read);

  const result = checkBrandFileCoverage(read.declarations);
  printCoverageReport(result);

  // An unparsed region of the FILE (`read.unchecked`) or an unclassified
  // declaration KEY the check itself flagged (`result.unchecked`) both mean
  // the same thing: part of what should have been examined was not — see
  // this file's own top doc comment for why that is a `2`, not a `1`.
  // Every finding is still printed above, so nothing real is hidden — this
  // only refuses to let the run as a whole read as clean or fully
  // accounted for.
  if (read.unchecked.length > 0 || result.unchecked.length > 0) return 2;

  return result.findings.length > 0 ? 1 : 0;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`tokens-brand-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`tokens-brand-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      process.exitCode = 2;
    }
  }
}

/**
 * Same real-path guard `@vespeneventures/copy`'s `cli.ts` and
 * `@vespeneventures/strategy`'s `cli.ts` both use, for the same reason: `npm
 * install` publishes `bin` entries as symlinks, so comparing
 * `process.argv[1]` to `import.meta.url` without resolving symlinks on both
 * sides fails the moment this file is actually invoked the only way it
 * ships — as an installed CLI — and does so silently (`run()` never fires,
 * nothing prints, exit code 0).
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
