#!/usr/bin/env node
/**
 * `copy-check` — the CLI for `checkCopyTraceability`. Presentation only:
 * parse argv, load the copy record (via the sibling `registry.ts`), walk
 * the scan directory (`scan.ts`), run the pure gate (`copy-gate.ts`),
 * print a report — including every skip/exclusion count, never just the
 * findings — and pick an exit code. Matches
 * `@vespeneventures/strategy`'s `strategy-facts-check` shape closely,
 * deliberately: same three-state exit-code contract, same argument order
 * (the thing being checked FOR, then the thing being checked), same
 * `--help`, same `CliInputError` split between "bad arguments" and
 * "ran, found something wrong".
 *
 * Exit codes — a contract a consumer's CI depends on, matching this
 * repository's `foundry-check` convention (`@vespeneventures/gates`):
 *
 *   0 — ran cleanly: the copy record loaded, at least one file was
 *       actually scanned (successfully tokenized — see `scan.ts`'s
 *       `ScanResult.filesScanned`), zero findings.
 *   1 — ran cleanly, at least one finding (an unregistered copy candidate,
 *       or a citation to a copy id that does not exist).
 *   2 — could not run: bad input, the copy record missing/unreadable/
 *       invalid, the scan directory does not exist, the walk matched zero
 *       files, every matched file failed to tokenize (so, despite files
 *       matching, zero were actually scanned), an unreadable directory
 *       during the walk, or an unexpected exception. Kept strictly
 *       distinct from 1 — a gate that reports "clean" after failing to run
 *       is worse than no gate at all. This is the explicit third state
 *       this gate is built around: "could not check" must never be
 *       reported as a pass.
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCopyTraceability, type CopyGateResult } from "./copy-gate.js";
import { readCopyRecord } from "./registry.js";
import { scanCopySourceTree, type ScanResult } from "./scan.js";

const USAGE = `Usage: copy-check <record-file> [scan-dir] [options]

  record-file    Path to a CopyRecord JSON file (see @vespeneventures/copy's README). Required.
  scan-dir       Directory to scan for user-facing string/template literals. Defaults to the current working directory.

Options:
  --help         Print this message and exit 0.

Exit codes: 0 = clean, 1 = at least one finding, 2 = could not run (bad input, missing/invalid record, nothing matched to scan, or every matched file failed to parse).
`;

/** Exported for `cli.test.ts` — anything wrong with the arguments themselves always maps to exit code 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  recordFile?: string;
  scanDir?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let recordFile: string | undefined;
  let scanDir: string | undefined;
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    }
    if (recordFile === undefined) {
      recordFile = arg;
    } else if (scanDir === undefined) {
      scanDir = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { recordFile, scanDir, help };
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
 * Prints every scan-side accounting number — matched, excluded (by
 * reason), skipped-by-design, and parse failures — unconditionally, not
 * only when something looks wrong. This is the direct fix for the failure
 * mode this package's own brief warns against: "if your scanner skips
 * files, skips a syntax it cannot parse, or excludes a category of
 * literal, the run output must say how many and why. A gate that quietly
 * narrows its own coverage and reports the narrowed result as a pass is
 * the exact failure mode above."
 */
function printScanAccounting(scan: ScanResult): void {
  console.log(
    `Scanned ${scan.filesScanned} file${scan.filesScanned === 1 ? "" : "s"}, ` +
      `${scan.candidates.length} candidate${scan.candidates.length === 1 ? "" : "s"} extracted.`,
  );

  if (scan.excluded.length > 0) {
    const byReason = new Map<string, number>();
    for (const e of scan.excluded) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
    console.log(`${scan.excluded.length} literal(s) deliberately excluded (never registered as copy):`);
    for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}  ${reason}`);
    }
  }

  if (scan.skippedByDesign.length > 0) {
    console.log(`${scan.skippedByDesign.length} file(s) skipped by design (test/check/declaration files):`);
    for (const s of scan.skippedByDesign) console.log(`  ${s.file}`);
  }

  if (scan.parseFailures.length > 0) {
    console.error(`${scan.parseFailures.length} file(s) could NOT be parsed and were NOT scanned for copy:`);
    for (const p of scan.parseFailures) console.error(`  ${p.file}: ${p.detail}`);
  }
}

function printGateReport(result: CopyGateResult): void {
  console.log(
    `${result.candidatesScanned} candidate${result.candidatesScanned === 1 ? "" : "s"} evaluated, ` +
      `${result.matched} matched a registered entry.`,
  );
  if (result.ignored.length > 0) {
    console.log(`${result.ignored.length} explicitly ignored via "copy-gate:ignore":`);
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

/**
 * Exported (unlike a typical CLI `main`) so `cli.test.ts` can exercise the
 * whole argv-to-exit-code contract directly, against real `mkdtemp` temp
 * directories, without spawning a subprocess for every case. Takes `argv`
 * as a parameter rather than reading `process.argv` itself for exactly
 * that reason — `run()` below is the only caller that reads the real
 * `process.argv`.
 */
export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.recordFile) {
    throw new CliInputError("record-file is required");
  }

  const recordFile = resolve(args.recordFile);
  const scanDir = resolve(args.scanDir ?? process.cwd());
  requireFile("record-file", recordFile);
  requireDirectory("scan-dir", scanDir);

  console.log(`Copy record: ${recordFile}`);
  console.log(`Scan directory: ${scanDir}`);

  // The copy record itself missing/unreadable/unparseable/invalid is
  // fail-closed: there is no trustworthy set of registered entries to
  // check candidates against, so this is "could not run", never a clean
  // pass produced from zero entries — the same discipline
  // `strategy-facts-check` holds `facts.json` to.
  const read = readCopyRecord(recordFile);
  if (!read.complete || !read.record) {
    console.error(`\nCopy record could not be loaded:`);
    for (const issue of read.issues) console.error(`  [${issue.reason}] ${issue.detail}`);
    console.error("Refusing to report a pass with no trustworthy copy record to check source against.");
    return 2;
  }

  const scan = scanCopySourceTree(scanDir); // throws (fail-closed) on an unreadable directory — caught by run()
  printScanAccounting(scan);

  // Zero files SUCCESSFULLY scanned is the exact failure mode this gate is
  // built to never silently pass: "nothing to scan" (the walk matched no
  // files at all) and "everything that matched failed to parse" (see
  // scan.parseFailures) are both, deliberately, the same outcome here —
  // neither one is "scanned everything, found nothing wrong".
  if (scan.filesScanned === 0) {
    console.error(
      scan.parseFailures.length > 0
        ? `\nEvery file matched under "${scanDir}" failed to parse — nothing was actually scanned.`
        : `\nNo files matched under "${scanDir}" — nothing was scanned.`,
    );
    console.error("Refusing to report a pass for a scan that checked nothing.");
    return 2;
  }

  const result = checkCopyTraceability(scan.candidates, scan.citations, read.record, scan.filesScanned);
  printGateReport(result);

  return result.findings.length > 0 ? 1 : 0;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`copy-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`copy-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      process.exitCode = 2;
    }
  }
}

/**
 * Same real-path guard `@vespeneventures/strategy`'s `cli.ts` and
 * `@vespeneventures/gates`' `cli.ts` both use, for the same reason: `npm
 * install` publishes `bin` entries as symlinks, so comparing
 * `process.argv[1]` to `import.meta.url` without resolving symlinks on
 * both sides fails the moment this file is actually invoked the only way
 * it ships — as an installed CLI — and does so silently (`run()` never
 * fires, nothing prints, exit code 0). See `strategy`'s `cli.ts` doc
 * comment for the full story; this is the same fix, applied here.
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
