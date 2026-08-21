#!/usr/bin/env node
/**
 * `publisher-record-check` — the CLI for all three of this package's gates:
 * `checkLedgerDrift` (the default, no-subcommand invocation),
 * `checkAppendOnly` (the `append-only` subcommand), and
 * `checkJoinKeyCompleteness` (the `join-key` subcommand). Presentation and
 * I/O only in every case: parse argv, read JSON files, run the pure gate,
 * print a report, pick an exit code. All real logic lives in `drift.ts`,
 * `append-only-gate.ts`, and `join-key.ts` respectively.
 *
 * Dispatch happens on `argv[0]` — the literal first token a caller passes
 * on the command line — never on the invoked binary's path or filename.
 * This repository invokes every gate by its compiled path (e.g. `node
 * packages/controller/dist/cli.js`), so a dispatch keyed off
 * `basename(process.argv[1])` would always see `cli.js` and silently run
 * the wrong command. See `main` below for the actual dispatch.
 *
 * Exit codes for the default (drift) invocation — matching this
 * repository's three-state convention (`strategy-facts-check`,
 * `copy-check`, `foundry-check`):
 *
 *   0 — ran cleanly: the ledger validated, at least one citation was
 *       compared against a current value, and none had drifted.
 *   1 — ran cleanly, but at least one cited fact has drifted since
 *       publication.
 *   2 — could not run: bad arguments, a file missing/unreadable/not valid
 *       JSON, a ledger that doesn't validate, an empty ledger, a ledger
 *       whose citations could not be compared to any current value, or an
 *       unexpected exception. Kept strictly distinct from 1 — a drift
 *       checker that reports "clean" after failing to check anything is
 *       worse than no checker at all.
 *
 * Exit codes for the `append-only` subcommand — the same three-state
 * convention, applied to `checkAppendOnly` instead of `checkLedgerDrift`:
 *
 *   0 — "next" is a valid, order-preserving append-only evolution of
 *       "previous", verified over at least one entry in "previous".
 *   1 — a real violation: an entry present in "previous" was removed,
 *       reordered, or mutated in "next" (`checkAppendOnly` returned at
 *       least one finding).
 *   2 — could not evaluate: bad arguments, a file missing/unreadable/not
 *       valid JSON, either ledger failing its own shape validation, or
 *       "previous" having zero entries. Zero entries is deliberately its
 *       own exit code, never folded into 0 — "verified nothing" and
 *       "verified everything and it held" must never look like the same
 *       result to a CI job branching on this exit code, the same
 *       three-state discipline `checkLedgerDrift`'s empty-ledger case
 *       already holds this CLI to above.
 *
 * Exit codes for the `join-key` subcommand — the same three-state
 * convention, applied to `checkJoinKeyCompleteness` (issue #376):
 *
 *   0 — every entry this ledger currently treats as live carries a
 *       complete join key, verified over at least one live entry.
 *   1 — a real violation: a live entry is missing its content identity or
 *       carries an invalid window (`"join-key-missing-identity"` /
 *       `"join-key-window-invalid"`), or two entries publishing to the
 *       same address disagree on content identity
 *       (`"join-key-identity-churn"`).
 *   2 — could not evaluate: bad arguments, a file missing/unreadable/not
 *       valid JSON, a ledger that doesn't validate, an empty ledger, or a
 *       non-empty ledger with zero entries currently live. Zero live
 *       entries is deliberately its own exit code, never folded into 0 —
 *       publishing nothing live right now is not evidence that publishing
 *       is governed, the same three-state discipline the other two
 *       subcommands already hold this CLI to above.
 */

import { readFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkAppendOnly } from "./append-only-gate.js";
import { checkLedgerDrift, type DriftReport } from "./drift.js";
import { checkJoinKeyCompleteness, type JoinKeyReport } from "./join-key.js";
import type { LedgerFinding } from "./types.js";

const USAGE = `Usage: publisher-record-check <ledger-file> <current-values-file> [options]
       publisher-record-check append-only <previous-ledger-file> <next-ledger-file> [options]
       publisher-record-check join-key <ledger-file> [options]

  ledger-file           Path to a JSON file containing a Ledger (an array of PublicationEntry). Required.
  current-values-file   Path to a JSON file containing a flat object mapping factRef -> current value. Required.

Options:
  --help   Print this message and exit 0.

Exit codes: 0 = clean (something was checked, nothing drifted), 1 = at least one cited fact has drifted, 2 = could not run (bad input, missing/unreadable/invalid JSON, an invalid or empty ledger, or nothing could be checked).

Run "publisher-record-check append-only --help" for the append-only subcommand's own usage.
Run "publisher-record-check join-key --help" for the join-key subcommand's own usage.
`;

const APPEND_ONLY_USAGE = `Usage: publisher-record-check append-only <previous-ledger-file> <next-ledger-file> [options]

  previous-ledger-file   Path to a JSON file containing a Ledger (an array of PublicationEntry) — e.g. a base ref's copy. Required.
  next-ledger-file       Path to a JSON file containing a Ledger — e.g. a head ref's copy, checked against previous-ledger-file for a pure, order-preserving append. Required.

Options:
  --help   Print this message and exit 0.

Exit codes: 0 = next is a valid append-only evolution of previous, verified over at least one entry; 1 = a real violation (an entry removed, reordered, or mutated); 2 = could not evaluate (bad input, missing/unreadable/invalid JSON, a ledger failing its own shape validation, or zero entries in previous to check against).
`;

const JOIN_KEY_USAGE = `Usage: publisher-record-check join-key <ledger-file> [options]

  ledger-file   Path to a JSON file containing a Ledger (an array of PublicationEntry). Required.

Options:
  --help   Print this message and exit 0.

Exit codes: 0 = every currently-live entry carries a complete join key, verified over at least one; 1 = a live entry is missing its content identity or window, or two entries at the same address disagree on identity; 2 = could not evaluate (bad input, missing/unreadable/invalid JSON, an invalid or empty ledger, or zero entries currently live).
`;

/** Exported for `cli.test.ts` — anything wrong with the arguments or input files always maps to exit code 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  ledgerFile?: string;
  currentValuesFile?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let ledgerFile: string | undefined;
  let currentValuesFile: string | undefined;
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    }
    if (ledgerFile === undefined) {
      ledgerFile = arg;
    } else if (currentValuesFile === undefined) {
      currentValuesFile = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { ledgerFile, currentValuesFile, help };
}

interface AppendOnlyParsedArgs {
  previousFile?: string;
  nextFile?: string;
  help: boolean;
}

function parseAppendOnlyArgs(argv: string[]): AppendOnlyParsedArgs {
  let previousFile: string | undefined;
  let nextFile: string | undefined;
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    }
    if (previousFile === undefined) {
      previousFile = arg;
    } else if (nextFile === undefined) {
      nextFile = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { previousFile, nextFile, help };
}

interface JoinKeyParsedArgs {
  ledgerFile?: string;
  help: boolean;
}

function parseJoinKeyArgs(argv: string[]): JoinKeyParsedArgs {
  let ledgerFile: string | undefined;
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    }
    if (ledgerFile === undefined) {
      ledgerFile = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { ledgerFile, help };
}

/**
 * Reads `path`'s raw text, throwing `CliInputError` on anything about the
 * path itself being wrong — missing, unreadable, not a plain file. These
 * are argument-shaped problems, the same category
 * `@vespeneventures/strategy`'s `cli.ts` reserves for `requireDirectory`
 * (a bad argument, not a fact about the file's own content), so they throw
 * the same way an unknown flag does.
 */
function readFileText(label: string, path: string): string {
  if (!existsSync(path)) {
    throw new CliInputError(`${label} "${path}" does not exist`);
  }
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    throw new CliInputError(`cannot read ${label} "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile()) {
    throw new CliInputError(`${label} "${path}" is not a file`);
  }
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new CliInputError(`cannot read ${label} "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Parses `raw` as JSON, returning `{ ok: true, value }` or `{ ok: false,
 * message }` — never throwing. Malformed JSON in an otherwise-readable
 * file is a CONTENT problem, not an argument problem: the same
 * distinction `strategy-facts-check`'s `cli.ts` draws between a bad
 * `strategy-dir` argument (throws `CliInputError`) and a present but
 * invalid `facts.json` (handled internally, printed, mapped to exit code
 * `2` without ever throwing). `main` below makes the same call for a
 * malformed ledger or current-values file.
 */
function parseJson(raw: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function printReport(report: DriftReport): void {
  console.log(
    `Checked ${report.entriesChecked} entr${report.entriesChecked === 1 ? "y" : "ies"}: ` +
      `${report.citationsChecked} citation${report.citationsChecked === 1 ? "" : "s"} compared, ` +
      `${report.citationsUnchecked} unchecked (no current value supplied), ` +
      `${report.citationsDrifted} drifted.`,
  );
  if (report.findings.length === 0) {
    console.log("No findings.");
    return;
  }
  console.log(`\n${report.findings.length} finding(s):`);
  for (const f of report.findings) {
    const loc = f.path ? ` (${f.path})` : "";
    console.log(`  [${f.severity}] ${f.rule}${loc}: ${f.message}`);
  }
}

function printFindings(findings: readonly LedgerFinding[]): void {
  console.log(`${findings.length} finding(s):`);
  for (const f of findings) {
    const loc = f.path ? ` (${f.path})` : "";
    console.log(`  [${f.severity}] ${f.rule}${loc}: ${f.message}`);
  }
}

function printJoinKeyReport(report: JoinKeyReport): void {
  console.log(
    `Checked ${report.liveEntriesChecked} live entr${report.liveEntriesChecked === 1 ? "y" : "ies"}: ` +
      `${report.completeLiveEntries} complete, ${report.incompleteLiveEntries} incomplete. ` +
      `${report.identities.length} distinct content identit${report.identities.length === 1 ? "y" : "ies"} in the ledger.`,
  );
  if (report.findings.length === 0) {
    console.log("No findings.");
    return;
  }
  console.log(`\n${report.findings.length} finding(s):`);
  for (const f of report.findings) {
    const loc = f.path ? ` (${f.path})` : "";
    console.log(`  [${f.severity}] ${f.rule}${loc}: ${f.message}`);
  }
}

/**
 * Dispatcher. Checked BEFORE `parseArgs`/the drift-check argument shape —
 * on the literal first argv token, never on the invoked binary's path or
 * filename — so this repository's compiled-path invocations (`node
 * dist/cli.js <ledger-file> <current-values-file>`) keep running the drift
 * check exactly as before, and only a caller that actually types
 * `append-only` or `join-key` first gets that gate instead. Exported
 * (unlike a typical CLI `main`) so `cli.test.ts` can exercise the whole
 * argv-to-exit-code contract directly, without spawning a subprocess for
 * every case — `run()` below is the only caller that reads the real
 * `process.argv`.
 */
export function main(argv: string[]): number {
  if (argv[0] === "append-only") {
    return runAppendOnly(argv.slice(1));
  }
  if (argv[0] === "join-key") {
    return runJoinKeyCheck(argv.slice(1));
  }
  return runDriftCheck(argv);
}

/** The default (no-subcommand) invocation: `checkLedgerDrift`. This is exactly the previous, unchanged `main` body — see `main` above for why it now lives under its own name. */
function runDriftCheck(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.ledgerFile) {
    throw new CliInputError("ledger-file is required");
  }
  if (!args.currentValuesFile) {
    throw new CliInputError("current-values-file is required");
  }

  const ledgerPath = resolve(args.ledgerFile);
  const currentValuesPath = resolve(args.currentValuesFile);

  // Both reads can throw CliInputError (a bad path is an argument problem).
  const ledgerRaw = readFileText("ledger-file", ledgerPath);
  const currentValuesRawText = readFileText("current-values-file", currentValuesPath);

  console.log(`Ledger: ${ledgerPath}`);
  console.log(`Current values: ${currentValuesPath}`);

  // From here on, a problem is about CONTENT, not arguments — reported and
  // mapped to exit code 2 without ever throwing, the same "could not run"
  // category `checkLedgerDrift` itself uses for an invalid/empty ledger.
  const parsedLedger = parseJson(ledgerRaw);
  if (!parsedLedger.ok) {
    console.error(`\n${ledgerPath} is not valid JSON: ${parsedLedger.message}`);
    console.error("Refusing to report on drift for a ledger that could not even be parsed.");
    return 2;
  }

  const parsedCurrentValues = parseJson(currentValuesRawText);
  if (!parsedCurrentValues.ok) {
    console.error(`\n${currentValuesPath} is not valid JSON: ${parsedCurrentValues.message}`);
    console.error("Refusing to report on drift with no readable current values.");
    return 2;
  }
  if (typeof parsedCurrentValues.value !== "object" || parsedCurrentValues.value === null || Array.isArray(parsedCurrentValues.value)) {
    console.error(`\n${currentValuesPath} must contain a JSON object mapping factRef -> current value, got ${Array.isArray(parsedCurrentValues.value) ? "an array" : typeof parsedCurrentValues.value}.`);
    return 2;
  }

  const report = checkLedgerDrift(parsedLedger.value, parsedCurrentValues.value as Record<string, unknown>);
  printReport(report);

  if (!report.ok) {
    // Distinguish "found real drift" (1 — a content problem worth acting
    // on) from "could not meaningfully check" (2 — a ledger/input problem):
    // exactly the distinction this package's whole drift-checking design
    // exists to make visible, carried through to the exit code a CI job
    // actually branches on.
    return report.citationsDrifted > 0 ? 1 : 2;
  }
  return 0;
}

/**
 * The `append-only` subcommand: `checkAppendOnly`. Same shape as
 * `runDriftCheck` above — parse, read two files, run the pure gate, print,
 * pick an exit code — but the mapping from `checkAppendOnly`'s
 * `LedgerFinding[]` to an exit code is entirely this function's own job:
 * `checkAppendOnly` itself has no notion of exit codes, and (unlike
 * `checkLedgerDrift`'s `DriftReport`) does not distinguish "could not
 * evaluate" from "found a violation" in its return type — both come back
 * as findings. This function draws that line by rule name (see below) and,
 * separately, by checking "previous" for zero entries itself — the one
 * "could not evaluate" case `checkAppendOnly` cannot report on its own,
 * since an empty "previous" that "next" only adds to is, findings-wise,
 * indistinguishable from a real clean pass.
 */
function runAppendOnly(argv: string[]): number {
  const args = parseAppendOnlyArgs(argv);
  if (args.help) {
    console.log(APPEND_ONLY_USAGE);
    return 0;
  }
  if (!args.previousFile) {
    throw new CliInputError("previous-ledger-file is required");
  }
  if (!args.nextFile) {
    throw new CliInputError("next-ledger-file is required");
  }

  const previousPath = resolve(args.previousFile);
  const nextPath = resolve(args.nextFile);

  // Both reads can throw CliInputError (a bad path is an argument problem).
  const previousRaw = readFileText("previous-ledger-file", previousPath);
  const nextRaw = readFileText("next-ledger-file", nextPath);

  console.log(`Previous: ${previousPath}`);
  console.log(`Next: ${nextPath}`);

  // From here on, a problem is about CONTENT, not arguments — reported and
  // mapped to exit code 2 without ever throwing, the same "could not run"
  // category runDriftCheck uses for a malformed ledger/current-values file.
  const parsedPrevious = parseJson(previousRaw);
  if (!parsedPrevious.ok) {
    console.error(`\n${previousPath} is not valid JSON: ${parsedPrevious.message}`);
    console.error("Refusing to report on append-only-ness for a previous ledger that could not even be parsed.");
    return 2;
  }
  const parsedNext = parseJson(nextRaw);
  if (!parsedNext.ok) {
    console.error(`\n${nextPath} is not valid JSON: ${parsedNext.message}`);
    console.error("Refusing to report on append-only-ness for a next ledger that could not even be parsed.");
    return 2;
  }

  const findings = checkAppendOnly(parsedPrevious.value, parsedNext.value);

  // checkAppendOnly fails closed on shape by returning ONLY
  // "previous-ledger-invalid" or "next-*"-prefixed findings (see its own
  // doc comment) — never mixed with a genuine append-only violation
  // finding, since it returns immediately in both cases. Recognizing those
  // rule names is how this function tells "could not evaluate" (2) apart
  // from "evaluated and found a real problem" (1).
  const shapeInvalid = findings.some((f) => f.rule === "previous-ledger-invalid" || f.rule.startsWith("next-"));
  if (shapeInvalid) {
    printFindings(findings);
    console.error("\nCould not evaluate append-only-ness: at least one ledger failed its own shape validation.");
    return 2;
  }

  // Both ledgers validated (no shape errors) at this point, so "previous"
  // is safely a well-formed array — count its entries the same way
  // checkLedgerDrift's entriesChecked does, to tell "verified zero entries"
  // apart from "verified at least one and it held".
  const previousEntries = parsedPrevious.value as unknown[];
  if (previousEntries.length === 0) {
    console.log("Checked 0 entries: \"previous\" has zero entries, so there is nothing to verify \"next\" preserved.");
    console.error("\nRefusing to report a clean append-only result for a check that verified nothing.");
    return 2;
  }

  console.log(
    `Checked ${previousEntries.length} entr${previousEntries.length === 1 ? "y" : "ies"} from "previous" against "next".`,
  );
  if (findings.length === 0) {
    console.log("No findings — next is a valid append-only evolution of previous.");
    return 0;
  }
  printFindings(findings);
  return 1;
}

/**
 * The `join-key` subcommand: `checkJoinKeyCompleteness` (issue #376). Same
 * shape as `runDriftCheck`/`runAppendOnly` above — parse, read a file, run
 * the pure gate, print, pick an exit code — but only ONE file is read
 * (unlike `runDriftCheck`'s ledger + current-values pair): completeness is
 * a property of the ledger alone, never compared against anything external.
 *
 * `checkJoinKeyCompleteness` already returns a `DriftReport`-shaped result
 * (`ok`, count fields, `findings`) with its own three-state fail-closed
 * behavior baked in — `liveEntriesChecked: 0` on every "could not
 * meaningfully check" case (`"ledger-invalid"`, `"empty-ledger"`,
 * `"no-live-entries"`). That single field is what this function uses to
 * tell "could not evaluate" (2) apart from "evaluated and found a real
 * incompleteness/inconsistency problem" (1) — the same
 * `citationsDrifted > 0 ? 1 : 2` pattern `runDriftCheck` uses above, just
 * keyed on `liveEntriesChecked` instead.
 */
function runJoinKeyCheck(argv: string[]): number {
  const args = parseJoinKeyArgs(argv);
  if (args.help) {
    console.log(JOIN_KEY_USAGE);
    return 0;
  }
  if (!args.ledgerFile) {
    throw new CliInputError("ledger-file is required");
  }

  const ledgerPath = resolve(args.ledgerFile);

  // Can throw CliInputError (a bad path is an argument problem).
  const ledgerRaw = readFileText("ledger-file", ledgerPath);

  console.log(`Ledger: ${ledgerPath}`);

  // From here on, a problem is about CONTENT, not arguments — reported and
  // mapped to exit code 2 without ever throwing, the same "could not run"
  // category runDriftCheck/runAppendOnly use for a malformed ledger.
  const parsedLedger = parseJson(ledgerRaw);
  if (!parsedLedger.ok) {
    console.error(`\n${ledgerPath} is not valid JSON: ${parsedLedger.message}`);
    console.error("Refusing to report on join-key completeness for a ledger that could not even be parsed.");
    return 2;
  }

  const report = checkJoinKeyCompleteness(parsedLedger.value);
  printJoinKeyReport(report);

  if (!report.ok) {
    // Distinguish "found a real incompleteness/inconsistency problem" (1)
    // from "could not meaningfully check" (2 — an invalid/empty ledger, or
    // a ledger with zero entries currently live): the exact distinction
    // `checkJoinKeyCompleteness`'s own doc comment describes, carried
    // through to the exit code a CI job actually branches on.
    return report.liveEntriesChecked > 0 ? 1 : 2;
  }
  return 0;
}

function run(): void {
  const argv = process.argv.slice(2);
  const usage = argv[0] === "append-only" ? APPEND_ONLY_USAGE : argv[0] === "join-key" ? JOIN_KEY_USAGE : USAGE;
  try {
    process.exitCode = main(argv);
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`publisher-record-check: ${error.message}`);
      console.error(`\n${usage}`);
      process.exitCode = 2;
    } else {
      console.error(`publisher-record-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      process.exitCode = 2;
    }
  }
}

/**
 * Same real-path guard `@vespeneventures/gates`' and
 * `@vespeneventures/strategy`'s `cli.ts` use, for the same reason: `npm
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
    return false;
  }
}

if (detectMainModule()) {
  run();
}
