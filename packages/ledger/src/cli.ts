#!/usr/bin/env node
/**
 * `ledger-check` — the CLI for `checkLedgerDrift`. Presentation and I/O
 * only: parse argv, read two JSON files, run the pure gate, print a
 * report, pick an exit code. All real logic lives in `drift.ts`.
 *
 * Exit codes — matching this repository's three-state convention
 * (`strategy-facts-check`, `copy-check`, `foundry-check`):
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
 */

import { readFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLedgerDrift, type DriftReport } from "./drift.js";

const USAGE = `Usage: ledger-check <ledger-file> <current-values-file> [options]

  ledger-file           Path to a JSON file containing a Ledger (an array of PublicationEntry). Required.
  current-values-file   Path to a JSON file containing a flat object mapping factRef -> current value. Required.

Options:
  --help   Print this message and exit 0.

Exit codes: 0 = clean (something was checked, nothing drifted), 1 = at least one cited fact has drifted, 2 = could not run (bad input, missing/unreadable/invalid JSON, an invalid or empty ledger, or nothing could be checked).
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

/**
 * Exported (unlike a typical CLI `main`) so `cli.test.ts` can exercise the
 * whole argv-to-exit-code contract directly against real `mkdtemp` fixture
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

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`ledger-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`ledger-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
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
