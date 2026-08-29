#!/usr/bin/env node
/**
 * `publisher-media-check` — the CLI for `checkAssetCoverage`. Presentation only:
 * parse argv, load the asset record (via the sibling `registry.ts`), load
 * the referenced-ids file, run the pure coverage check (`coverage.ts`),
 * print a report — including every accounting number, never just the
 * findings — and pick an exit code. Matches `@clossys/writer`'s
 * `copy-check` and `@clossys/designer/tokens`' `tokens-brand-check` shape
 * deliberately: same three-state exit-code contract, same `--help`, same
 * `CliInputError` split between "bad arguments" and "ran, found something
 * wrong".
 *
 * The referenced-ids file is a plain JSON array of strings — the asset ids
 * a consumer's own documents actually bind (in practice, every
 * `SlotBinding.assetId` across a set of `@clossys/publisher/core`
 * documents). This package has no scanner of its own — unlike
 * `@clossys/writer`'s `copy-check`, which walks real source files, a
 * consumer's own build is the thing that actually knows which
 * `ComposeDocument`s exist and what they bind; this CLI's job starts one
 * step later, once that list has already been gathered into a file.
 *
 * Exit codes — a contract a consumer's CI depends on, matching this
 * repository's `foundry-check` convention (`@example/gates`):
 *
 *   0 — ran cleanly: the asset record loaded, the referenced-ids file
 *       loaded as a well-formed array of at least one non-empty string,
 *       every referenced id was actually checked (`unchecked` empty),
 *       zero findings.
 *   1 — ran cleanly, at least one finding (a referenced id with no
 *       registered entry, or a registered entry no id referenced).
 *   2 — could not run: bad input, the asset record missing/unreadable/
 *       invalid, the referenced-ids file missing/unreadable/unparseable/
 *       not-an-array, at least one referenced-ids entry that was not a
 *       non-empty string (`checkAssetCoverage`'s own `unchecked`), OR zero
 *       referenced ids were actually checked. That last case lands here,
 *       not as a silent `0`, deliberately: a coverage check that ran
 *       against nothing is "could not run [anything worth trusting]", not
 *       "ran and found the registry perfectly covered" — the explicit
 *       third state this whole package is built around, restated at the
 *       CLI boundary. See `coverage.ts`'s own top-of-file note #3.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkAssetCoverage, type AssetCoverageReport } from "./coverage.js";
import { readAssetRecord } from "./registry.js";

const USAGE = `Usage: publisher-media-check <record-file> <referenced-ids-file> [options]

  record-file           Path to an AssetRecord JSON file (see @clossys/publisher/media). Required.
  referenced-ids-file    Path to a JSON file containing an array of asset ids referenced by your documents (e.g. every SlotBinding.assetId). Required.

Options:
  --help         Print this message and exit 0.

Exit codes: 0 = clean, 1 = at least one finding, 2 = could not run (bad input, missing/invalid record, missing/invalid referenced-ids file, or zero referenced ids actually checked).
`;

/** Exported for `cli.test.ts` — anything wrong with the arguments themselves always maps to exit code 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  recordFile?: string;
  referencedIdsFile?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let recordFile: string | undefined;
  let referencedIdsFile: string | undefined;
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
    } else if (referencedIdsFile === undefined) {
      referencedIdsFile = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { recordFile, referencedIdsFile, help };
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

/** What reading the referenced-ids file at `path` produced, or why it did not. Kept local to the CLI — this shape has no reason to be part of this package's public API, unlike `AssetRegistryReadResult`. */
type ReferencedIdsReadResult =
  | { ok: true; ids: unknown[] }
  | { ok: false; reason: "unreadable" | "unparseable" | "not-an-array"; detail: string };

function readReferencedIdsFile(path: string): ReferencedIdsReadResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return { ok: false, reason: "unreadable", detail: error instanceof Error ? error.message : String(error) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: "unparseable", detail: error instanceof Error ? error.message : String(error) };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, reason: "not-an-array", detail: `expected a JSON array, got ${typeof parsed}` };
  }

  return { ok: true, ids: parsed };
}

/**
 * Prints every accounting number unconditionally, not only when something
 * looks wrong — the same discipline `copy-check`/`tokens-brand-check` hold
 * to: a gate that quietly narrows its own coverage and reports the
 * narrowed result as a pass is the exact failure mode this package's own
 * design brief was written against.
 */
function printCoverageReport(result: AssetCoverageReport): void {
  console.log(
    `${result.referencedCount} referenced id(s), ${result.checkedCount} checked, ` +
      `${result.registeredCount} registered entry/entries (${result.registeredByType.image} image, ` +
      `${result.registeredByType.video} video) in "${result.recordId}".`,
  );
  if (result.unchecked.length > 0) {
    console.error(`${result.unchecked.length} referenced id(s) could NOT be checked:`);
    for (const u of result.unchecked) console.error(`  ${u}`);
  }
  if (result.findings.length === 0) {
    console.log("No findings.");
    return;
  }
  console.log(`\n${result.findings.length} finding(s):`);
  for (const f of result.findings) {
    console.log(`  [${f.severity}] [${f.rule}] ${f.path ?? ""}  ${f.message}`);
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
  if (!args.referencedIdsFile) {
    throw new CliInputError("referenced-ids-file is required");
  }

  const recordFile = resolve(args.recordFile);
  const referencedIdsFile = resolve(args.referencedIdsFile);
  requireFile("record-file", recordFile);
  requireFile("referenced-ids-file", referencedIdsFile);

  console.log(`Asset record: ${recordFile}`);
  console.log(`Referenced ids: ${referencedIdsFile}`);

  // The asset record itself missing/unreadable/unparseable/invalid is
  // fail-closed: there is no trustworthy set of registered entries to
  // check ids against, so this is "could not run", never a clean pass
  // produced from an empty registry — the same discipline
  // `copy-check`/`tokens-brand-check` hold their own required input file
  // to.
  const read = readAssetRecord(recordFile);
  if (!read.complete || !read.record) {
    console.error(`\nAsset record could not be loaded:`);
    for (const issue of read.issues) console.error(`  [${issue.reason}] ${issue.detail}`);
    console.error("Refusing to report a pass with no trustworthy asset record to check against.");
    return 2;
  }

  const idsRead = readReferencedIdsFile(referencedIdsFile);
  if (!idsRead.ok) {
    console.error(`\nReferenced-ids file could not be loaded:`);
    console.error(`  [${idsRead.reason}] ${idsRead.detail}`);
    console.error("Refusing to report a pass with no trustworthy list of referenced ids to check.");
    return 2;
  }

  const result = checkAssetCoverage(idsRead.ids, read.record);
  printCoverageReport(result);

  // `unchecked` and "zero ids actually checked" both win over everything
  // else in the exit-code decision — see this file's own top doc comment
  // for why: a run that could not evaluate every referenced id, or that
  // had nothing to evaluate at all, must never read as a clean `0`. Every
  // finding was still printed above, so nothing real is hidden.
  if (result.unchecked.length > 0) return 2;
  if (result.checkedCount === 0) return 2;

  return result.findings.length > 0 ? 1 : 0;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`publisher-media-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`publisher-media-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      process.exitCode = 2;
    }
  }
}

/**
 * Same real-path guard `@clossys/writer`'s `cli.ts` and
 * `@clossys/designer/tokens`' `cli.ts` both use, for the same reason: `npm
 * install` publishes `bin` entries as symlinks, so comparing
 * `process.argv[1]` to `import.meta.url` without resolving symlinks on
 * both sides fails the moment this file is actually invoked the only way
 * it ships — as an installed CLI — and does so silently (`run()` never
 * fires, nothing prints, exit code 0).
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
