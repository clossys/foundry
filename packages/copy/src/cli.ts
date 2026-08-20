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
 * A second subcommand, `voice-derivation-coverage`, wires
 * `checkVoiceDerivationCoverage` (`./voice/derivation-coverage.ts`) in with
 * the identical shape: parse argv, load two JSON files, run the pure check,
 * print a report, pick an exit code from the same 0/1/2 contract — see
 * `runVoiceDerivationCoverage`'s own doc comment below. `main()` dispatches
 * to it only when `argv[0]` is exactly `"voice-derivation-coverage"`; any
 * other first argument (including every existing caller's real
 * `record-file` path) falls through to the original, unchanged behavior
 * above — this addition is purely additive to the argv contract.
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
 *       files, ANY matched file failed to tokenize (see `scan.parseFailures`
 *       — a file that could not be parsed was never examined for copy, and
 *       one such file among a hundred clean ones is still incomplete
 *       coverage, not a clean scan), an unreadable directory
 *       during the walk, an unexpected exception, a malformed
 *       `ScanOptions.pathExclusions` entry (see below), OR — as of the JSX
 *       text-node scanning added for issue #37 — at least one
 *       `ScanResult.unchecked` entry: a JSX construct the scanner
 *       recognized but could not reliably classify. That last case lands
 *       here, not as a `1`-severity finding, deliberately: `unchecked`
 *       means a REGION of an otherwise-matched, otherwise-parseable file
 *       was never actually examined for copy — the exact same shape of
 *       problem `parseFailures`/`filesScanned === 0` already are, just at
 *       finer grain (part of one file, rather than a whole file), so it
 *       gets the same answer they do. Every real finding is still printed
 *       first (see `printGateReport`) — `unchecked` does not suppress
 *       what WAS learned, it just refuses to let that partial picture
 *       read as "clean" the way a bare exit `0` would. Kept strictly
 *       distinct from 1 — a gate that reports "clean" after failing to
 *       run, OR after only partially running, is worse than no gate at
 *       all. This is the explicit third state this gate is built around:
 *       "could not check" must never be reported as a pass.
 *
 * A malformed `pathExclusions` entry (see `scan.ts`/`path-exclusions.ts`)
 * gets the same `2` treatment as `unchecked`, for the identical reason: an
 * exclusion list this run cannot trust means this run cannot say which
 * files were correctly in or out of scope, which is "could not run", not "a
 * clean scan that happened to find nothing". This CLI does not currently
 * accept `pathExclusions` from argv — see `main()`'s own comment — so this
 * only fires for a caller driving `scanCopySourceTree` directly with a
 * malformed list and inspecting `ScanResult` themselves; it is handled here
 * anyway so the accounting/exit-code contract stays correct for a future
 * CLI flag without a second pass over this logic.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCopyTraceability, type CopyGateResult } from "./copy-gate.js";
import { readCopyRecord } from "./registry.js";
import { scanCopySourceTree, type ScanResult } from "./scan.js";
import {
  checkVoiceDerivationCoverage,
  parseVoiceRecord,
  validateVoiceRecordShape,
  type VoiceDerivationCoverageResult,
} from "./voice/index.js";

const USAGE = `Usage: copy-check <record-file> [scan-dir] [options]
   or: copy-check voice-derivation-coverage <obligations-file> <voice-record-file> [options]

  record-file    Path to a CopyRecord JSON file (see @vespeneventures/copy's README). Required.
  scan-dir       Directory to scan for user-facing string/template literals. Defaults to the current working directory.

Options:
  --help         Print this message and exit 0.

Exit codes: 0 = clean, 1 = at least one finding, 2 = could not run (bad input, missing/invalid record, nothing matched to scan, or every matched file failed to parse).

Run "copy-check voice-derivation-coverage --help" for the second subcommand's own usage.
`;

const VOICE_DERIVATION_COVERAGE_USAGE = `Usage: copy-check voice-derivation-coverage <obligations-file> <voice-record-file> [options]

  obligations-file    Path to a JSON file containing an array of voice rule id strings (the thing being checked FOR). Required.
  voice-record-file   Path to a VoiceRecord JSON file (see @vespeneventures/copy/voice's README). Required.

Options:
  --help               Print this message and exit 0.

Checks, in both directions, whether obligations-file fully accounts for the voice rule ids (glossary terms, claim ids, pattern ids) voice-record-file declares — see checkVoiceDerivationCoverage's own doc comment (src/voice/derivation-coverage.ts).

Exit codes: 0 = satisfied, 1 = violated (a real coverage gap in either direction), 2 = indeterminate (could not run: bad input, missing/unreadable/unparseable/invalid file, zero obligations supplied, or zero voice rule ids declared in the record).
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

  if (scan.excludedFiles.length > 0) {
    console.log(`${scan.excludedFiles.length} file(s) excluded via pathExclusions (never scanned):`);
    for (const e of scan.excludedFiles) console.log(`  ${e.file}  (pattern "${e.pattern}": ${e.reason})`);
  }

  if (scan.pathExclusionFindings.length > 0) {
    for (const f of scan.pathExclusionFindings) {
      const line = `  [${f.rule}] ${f.path ? `"${f.path}": ` : ""}${f.message}`;
      if (f.severity === "error") console.error(line);
      else console.log(line);
    }
  }

  if (scan.parseFailures.length > 0) {
    console.error(`${scan.parseFailures.length} file(s) could NOT be parsed and were NOT scanned for copy:`);
    for (const p of scan.parseFailures) console.error(`  ${p.file}: ${p.detail}`);
  }

  // JSX constructs the scanner recognized but could not classify — the
  // same "could not check" severity as a parse failure (console.error,
  // not console.log), because it means the same thing: some part of a
  // matched file was never actually examined for copy. `main()` below is
  // what turns a non-empty list here into exit code 2 — see its own doc
  // comment for why.
  if (scan.unchecked.length > 0) {
    console.error(
      `${scan.unchecked.length} JSX construct(s) recognized but NOT reliably classified — coverage for these is incomplete:`,
    );
    for (const u of scan.unchecked) console.error(`  [${u.kind}] ${u.file}:${u.line}  ${u.detail}`);
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

// ---------------------------------------------------------------------
// voice-derivation-coverage — the second subcommand. See this file's
// top-of-file doc comment and `./voice/derivation-coverage.ts` for the
// full design; everything below is presentation only, the same split
// `main()` above draws for `checkCopyTraceability`.
// ---------------------------------------------------------------------

interface VoiceDerivationCoverageArgs {
  obligationsFile?: string;
  voiceRecordFile?: string;
  help: boolean;
}

function parseVoiceDerivationCoverageArgs(argv: string[]): VoiceDerivationCoverageArgs {
  let obligationsFile: string | undefined;
  let voiceRecordFile: string | undefined;
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    }
    if (obligationsFile === undefined) {
      obligationsFile = arg;
    } else if (voiceRecordFile === undefined) {
      voiceRecordFile = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { obligationsFile, voiceRecordFile, help };
}

type JsonReadResult = { ok: true; value: unknown } | { ok: false; detail: string };

/**
 * Reads and JSON-parses a file, never throwing: an I/O failure or a JSON
 * syntax error is returned as `{ ok: false, detail }`, the same
 * never-throw discipline `readCopyRecord` (`registry.ts`) holds to for the
 * copy record it loads. Kept local to this file rather than promoted to a
 * shared helper: `./voice` is deliberately zero-I/O (see `checker.ts`'s own
 * doc comment, "Pure, no I/O"), so the one place in this package that reads
 * a `VoiceRecord` off disk is this CLI, not the `voice` module itself.
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

type ObligationsReadResult = { ok: true; value: string[] } | { ok: false; detail: string };

/** `obligations-file` must be a JSON array of non-empty strings — the plain rule-id list `checkVoiceDerivationCoverage` takes. Any other shape is "could not run", never a silently-empty obligation list. */
function readObligations(path: string): ObligationsReadResult {
  const parsed = readJsonFile("obligations-file", path);
  if (!parsed.ok) return parsed;
  const { value } = parsed;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) {
    return { ok: false, detail: `obligations-file "${path}" must be a JSON array of non-empty strings, got ${JSON.stringify(value)}.` };
  }
  return { ok: true, value };
}

function printVoiceDerivationCoverageReport(result: VoiceDerivationCoverageResult): void {
  console.log(
    `${result.obligationsChecked} obligation(s) checked against ${result.rulesChecked} voice rule id(s) declared in the record.`,
  );
  if (result.obligationsMissingFromRecord.length > 0) {
    console.log(`${result.obligationsMissingFromRecord.length} obligation(s) name a rule id the record does not declare:`);
    for (const id of result.obligationsMissingFromRecord) console.log(`  ${id}`);
  }
  if (result.recordRulesNotObliged.length > 0) {
    console.log(`${result.recordRulesNotObliged.length} voice rule id(s) in the record are reached by no obligation:`);
    for (const id of result.recordRulesNotObliged) console.log(`  ${id}`);
  }
  if (result.ok) {
    console.log("Voice derivation coverage: satisfied.");
  } else if (result.reason === "coverage-gap") {
    console.log("Voice derivation coverage: violated.");
  } else {
    console.log(`Voice derivation coverage: indeterminate (${result.reason}).`);
  }
}

/**
 * `voice-derivation-coverage`'s own `main`-equivalent: parse argv, load the
 * two JSON files, run `checkVoiceDerivationCoverage`, print a report, pick
 * an exit code — the identical shape `main()` uses for `checkCopyTraceability`
 * above, projected onto this gate's own three-state result.
 *
 * A file that is missing/unreadable/unparseable/schema-invalid never
 * reaches `checkVoiceDerivationCoverage` at all: it is "could not run"
 * (exit `2`), decided and reported here, before the pure check function is
 * ever called — exactly how `main()` above never calls
 * `checkCopyTraceability` when `readCopyRecord` fails. `checkVoiceDerivationCoverage`
 * itself only ever sees a real, already-valid `VoiceRecord` and a real
 * `string[]`; its own `"no-obligations-provided"`/`"no-rules-in-record"`
 * indeterminate reasons are for a run that loaded cleanly but had nothing
 * to compare.
 */
function runVoiceDerivationCoverage(argv: string[]): number {
  const args = parseVoiceDerivationCoverageArgs(argv);
  if (args.help) {
    console.log(VOICE_DERIVATION_COVERAGE_USAGE);
    return 0;
  }
  if (!args.obligationsFile) {
    throw new CliInputError("obligations-file is required");
  }
  if (!args.voiceRecordFile) {
    throw new CliInputError("voice-record-file is required");
  }

  const obligationsFile = resolve(args.obligationsFile);
  const voiceRecordFile = resolve(args.voiceRecordFile);
  requireFile("obligations-file", obligationsFile);
  requireFile("voice-record-file", voiceRecordFile);

  console.log(`Obligations file: ${obligationsFile}`);
  console.log(`Voice record file: ${voiceRecordFile}`);

  const obligationsRead = readObligations(obligationsFile);
  if (!obligationsRead.ok) {
    console.error(`\nObligations could not be loaded: ${obligationsRead.detail}`);
    console.error("Refusing to report a pass with no trustworthy obligation list to check against.");
    return 2;
  }

  const recordJson = readJsonFile("voice-record-file", voiceRecordFile);
  if (!recordJson.ok) {
    console.error(`\nVoice record could not be loaded: ${recordJson.detail}`);
    console.error("Refusing to report a pass with no trustworthy voice record to check against.");
    return 2;
  }

  const shapeFindings = validateVoiceRecordShape(recordJson.value);
  if (shapeFindings.length > 0) {
    console.error(`\nVoice record "${voiceRecordFile}" is not a valid VoiceRecord:`);
    for (const f of shapeFindings) console.error(`  [${f.rule}] ${f.path ?? "(root)"}: ${f.message}`);
    console.error("Refusing to report a pass with no trustworthy voice record to check against.");
    return 2;
  }
  const record = parseVoiceRecord(recordJson.value);

  const result = checkVoiceDerivationCoverage(obligationsRead.value, record);
  printVoiceDerivationCoverageReport(result);

  // Same fail-closed mapping `main()` uses above, restated for this gate's
  // own three-state result: `indeterminate` (nothing meaningful was
  // compared) is `2`, never `0` and never conflated with a real `1`
  // violation.
  if (!result.ok && result.reason !== "coverage-gap") return 2;
  return result.ok ? 0 : 1;
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
  // Subcommand dispatch: only `argv[0] === "voice-derivation-coverage"`
  // exactly diverts to the second subcommand — see this file's top-of-file
  // doc comment. Every other first argument, including any real
  // `record-file` path an existing caller already passes, falls straight
  // through to the original behavior below, unchanged.
  if (argv[0] === "voice-derivation-coverage") {
    return runVoiceDerivationCoverage(argv.slice(1));
  }

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

  // No argv flag populates `pathExclusions` today — this CLI always calls
  // `scanCopySourceTree` with defaults (`[]`), so `scan.excludedFiles`/
  // `scan.pathExclusionFindings` are always empty in THIS binary as
  // shipped. The accounting/exit-code handling below exists anyway so a
  // future flag (or a caller wrapping this same `main()`'s pieces with its
  // own options) does not require touching this exit-code logic again —
  // see this file's top doc comment.
  const scan = scanCopySourceTree(scanDir); // throws (fail-closed) on an unreadable directory — caught by run()
  printScanAccounting(scan);

  // A malformed pathExclusions entry means this run cannot trust which
  // files were correctly excluded — "could not run", not "ran and found
  // nothing wrong". Checked before the files-scanned gate below: an invalid
  // exclusion list is a configuration problem independent of whether the
  // walk itself found anything.
  const invalidPathExclusions = scan.pathExclusionFindings.filter((f) => f.severity === "error");
  if (invalidPathExclusions.length > 0) {
    console.error(
      `\n${invalidPathExclusions.length} pathExclusions entr${invalidPathExclusions.length === 1 ? "y is" : "ies are"} invalid — refusing to report a pass built on an exclusion list that cannot be trusted.`,
    );
    return 2;
  }

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

  // A file that failed to parse was matched, was in scope, and was never
  // examined for copy — and the check above only catches the case where
  // EVERY file failed. One parse failure among a hundred clean files used
  // to land here with `filesScanned > 0` and be dropped from the exit-code
  // decision entirely: the run reported on the files it could read and
  // exited 0 or 1 as if the unreadable one had been checked and found
  // clean. That is the same collapse `unchecked` is handled below to
  // prevent, only coarser — a whole file never examined rather than a
  // construct within one — so it gets the same answer, for the reason
  // this file's own header already gave for `unchecked`: "a gate that
  // reports 'clean' after failing to run, OR after only partially
  // running, is worse than no gate at all."
  //
  // Every parse failure was already printed in full by
  // `printScanAccounting` above, and every finding from the files that DID
  // parse is still printed below — this refuses to let the run as a whole
  // read as fully accounted-for, it does not hide anything that was
  // learned.
  if (scan.parseFailures.length > 0) {
    console.error(
      `\n${scan.parseFailures.length} of ${scan.parseFailures.length + scan.filesScanned} matched file(s) under "${scanDir}" could not be parsed and were never examined for copy.`,
    );
    console.error("Refusing to report a pass for a scan whose coverage is incomplete.");
    return 2;
  }

  const result = checkCopyTraceability(scan.candidates, scan.citations, read.record, scan.filesScanned, scan.unchecked);
  printGateReport(result);

  // `unchecked` wins over everything else in the exit-code decision — see
  // this file's own top doc comment for why it is a `2`, not a `1`: it
  // means part of a matched file was never actually examined, which is
  // "could not run [fully]", not "ran and found something wrong". Every
  // finding was still printed above, so nothing real is hidden — this
  // only refuses to let the run as a whole read as clean or as
  // fully-accounted-for.
  if (result.unchecked.length > 0) return 2;

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
