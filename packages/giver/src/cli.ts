#!/usr/bin/env node
/**
 * `giver-check` — one bin, three gates, dispatched on `argv[0]` matching a
 * subcommand name EXACTLY.
 *
 * Dispatch is on `argv[0]`, never on `basename(process.argv[1])`. A bin-name
 * dispatch would see `cli.js` wherever this gate is invoked by its compiled
 * path — which is exactly how this repository's own `npm run check` invokes
 * other packages' gates — and would silently run the wrong command, or none.
 *
 * Presentation only: parse argv, load JSON files, run the pure checkers in
 * `contract.ts`, print a report, pick an exit code. Every decision worth
 * testing lives in `contract.ts` and is tested there directly, against
 * plain values, with no filesystem involved.
 *
 * EXIT CODES — the contract a consumer's CI depends on (this repository's
 * own contribution guide, "Gate CLIs exit `0` clean, `1` findings, `2`
 * could not run"):
 *
 *   0 — ran cleanly against a non-empty record set and found nothing.
 *   1 — ran cleanly and found at least one real violation.
 *   2 — could not run. Kept strictly distinct from `1`, because "I checked
 *       and it is fine" and "I never checked" are different answers and a
 *       gate that reports the second as the first is worse than no gate.
 *
 * `2` is genuinely reachable here, on every subcommand, and each route is
 * tested:
 *   - a record store that cannot be read — missing file, unreadable file,
 *     a directory where a file was named, invalid JSON, or JSON that does
 *     not validate against this package's own schema;
 *   - nothing to scan — an empty record set, which is not a clean run, it
 *     is a run that examined nothing;
 *   - nothing DUE — every hand-off still inside its declared service level,
 *     or every obligation still inside its declared window. Nothing has
 *     come due, so nothing was compared;
 *   - an outcome that could not be established — an obligation whose sends
 *     were attempted and never observed. That is not a breach and it is
 *     certainly not a discharge;
 *   - a required declared value that was not supplied — `--at`, which has
 *     no default anywhere in this package. Reading the clock here would
 *     make every run unrepeatable and every late record's lateness depend
 *     on when someone happened to look;
 *   - NO GATE SELECTED AT ALL. A bare `giver-check` with no subcommand is
 *     a run that never happened, and it exits `2`, not `0` — see `main()`'s
 *     own comment for why an explicitly requested `--help` is the one
 *     argument-shaped `0` here and a dropped argument is not.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkGrounding,
  checkHandoffPlacement,
  checkObligationDischarge,
  type GroundingResult,
  type HandoffPlacementResult,
  type ObligationDischargeResult,
} from "./contract.js";
import {
  validateAnswerRecords,
  validateDeliveryProofs,
  validateHandoffRecords,
  validateObligationRecords,
  validatePlacementRecords,
  validateRetainedGrounds,
} from "./schema.js";
import type { ValidationResult } from "./validation.js";

const USAGE = `Usage: giver-check <gate> [arguments]

Gates:
  handoff-placement <handoffs-file> <placements-file> --at <timestamp>
      Fails when a hand-off's declared service level elapsed with no
      placement record, when it was picked up after that level had already
      elapsed, when a placement predates the hand-off it answers, or when a
      placement names a hand-off outside the set being checked.

  grounding <answers-file> <retained-grounds-file>
      Fails when a delivered answer cites no source, when a refusal retains
      no grounds, or when either cites material the consumer no longer
      holds.

  obligation-discharge <obligations-file> <proofs-file> --at <timestamp>
      Fails when a fired obligation's window closed with no delivery proof,
      when every recorded send against it failed, when a delivery landed
      outside the window, or when a proof names an obligation outside the
      set being checked. An attempted send whose outcome was never observed
      is indeterminate, and exits 2 rather than passing.

Options:
  --at <timestamp>  The instant to judge against. Required where it applies,
                    with no default: a gate that read its own clock could
                    never be replayed, and lateness would depend on when
                    someone happened to look.
  --help            Print this message and exit 0. Also available per gate.

Exit codes: 0 = clean, 1 = at least one finding, 2 = could not run (bad
arguments, a missing/unreadable/unparseable/invalid file, an empty record
set, nothing yet due, or an outcome that could not be established).
`;

const PLACEMENT_USAGE = `Usage: giver-check handoff-placement <handoffs-file> <placements-file> --at <timestamp>

  handoffs-file    JSON array of HandoffRecord objects. Required.
  placements-file  JSON array of PlacementRecord objects. Required. May be an empty array — an empty PLACEMENT set is a real, checkable state (every raised hand-off is then unplaced); an empty HAND-OFF set is not, and exits 2.
  --at <timestamp> The instant to judge against. Required, with no default.

Exit codes: 0 = every hand-off that came due was picked up in time, 1 = at least one was not, 2 = could not run (including a set in which nothing has come due yet).
`;

const GROUNDING_USAGE = `Usage: giver-check grounding <answers-file> <retained-grounds-file>

  answers-file           JSON array of AnswerRecord objects. Required.
  retained-grounds-file  JSON array of RetainedGround objects — the grounds the consumer says it still holds. Required. May be an empty array; an empty ANSWER set is not, and exits 2.

Exit codes: 0 = every delivery cites retained material and every refusal retains its grounds, 1 = at least one does not, 2 = could not run.
`;

const DISCHARGE_USAGE = `Usage: giver-check obligation-discharge <obligations-file> <proofs-file> --at <timestamp>

  obligations-file  JSON array of ObligationRecord objects. Required.
  proofs-file       JSON array of DeliveryProof objects — one entry per send attempt, carrying what was actually observed of it. Required. May be an empty array; an empty OBLIGATION set is not, and exits 2.
  --at <timestamp>  The instant to judge against. Required, with no default.

A proof recording state "failed" is a failed send, not a delivery, and does
not discharge anything. A proof recording state "unknown" is an attempt
nobody observed the outcome of: the obligation is unprovable, which exits 2.

Exit codes: 0 = every obligation that came due was proven delivered in time, 1 = at least one was breached, 2 = could not run.
`;

const GATES = ["handoff-placement", "grounding", "obligation-discharge"] as const;

/** Exported for `cli.test.ts` — anything wrong with the arguments themselves always maps to exit code 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  positional: string[];
  options: Map<string, string>;
  help: boolean;
}

/**
 * One argv parser for all three gates. `--name value` and `--name=value`
 * are both accepted; an unknown flag is a `CliInputError`, never a silently
 * ignored argument — a typo in a flag that carries a required declared
 * value must not read as that value being absent by choice.
 */
function parseArgs(argv: string[], knownOptions: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const options = new Map<string, string>();
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (!arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (!knownOptions.includes(name)) throw new CliInputError(`unknown flag "${name}"`);
    if (equals !== -1) {
      options.set(name, arg.slice(equals + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("-")) throw new CliInputError(`flag "${name}" requires a value`);
    options.set(name, next);
    i++;
  }

  return { positional, options, help };
}

/**
 * Why this record store cannot be read, or `undefined` if it can be.
 *
 * Deliberately NOT a `CliInputError`. A malformed argument is the caller's
 * mistake and belongs with the other argv errors; a record store that is
 * missing, unreadable, or is a directory where a file was named is the
 * store's condition, and it is exactly the "could not run" state this
 * gate's `2` exists for. Reporting it through the normal return path
 * rather than an exception is what lets `main()` itself be observed
 * returning `2` for it — a decline path nothing ever exercises is a
 * decline path nobody knows works.
 */
function fileProblem(label: string, path: string): string | undefined {
  if (!existsSync(path)) return `${label} "${path}" does not exist`;
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    return `cannot stat ${label} "${path}": ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!stat.isFile()) return `${label} "${path}" is not a file`;
  return undefined;
}

type JsonReadResult = { ok: true; value: unknown } | { ok: false; detail: string };

/**
 * Reads and JSON-parses a file, never throwing: an I/O failure or a syntax
 * error comes back as `{ ok: false, detail }`. This CLI is the only place
 * in this package that reads anything off disk — every checker in
 * `contract.ts` is pure.
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

/**
 * Load one record file and validate it against this package's own schema.
 * Returns the records, or `undefined` having already printed why — a file
 * that is missing, unreadable, unparseable, or schema-invalid never
 * reaches a checker at all: it is "could not run", decided here.
 */
function loadRecords<T>(label: string, path: string, validate: (value: unknown) => ValidationResult<T[]>): T[] | undefined {
  const problem = fileProblem(label, path);
  if (problem !== undefined) {
    console.error(`\n${label} could not be loaded: ${problem}`);
    console.error("Refusing to report a pass against a record store that could not be read.");
    return undefined;
  }
  const json = readJsonFile(label, path);
  if (!json.ok) {
    console.error(`\n${label} could not be loaded: ${json.detail}`);
    console.error("Refusing to report a pass against a record store that could not be read.");
    return undefined;
  }
  const shape = validate(json.value);
  if (!shape.ok) {
    console.error(`\n${label} "${path}" did not validate:`);
    for (const issue of shape.issues) console.error(`  ${issue.path}: ${issue.message}`);
    console.error("Refusing to report a pass against records this package cannot trust.");
    return undefined;
  }
  return shape.value;
}

/** `--at 2026-08-22T12:00:00.000Z`. No default: this package never reads the clock, so a run is replayable and lateness is a fact rather than a function of when someone looked. */
function parseAt(raw: string | undefined): string {
  if (raw === undefined) throw new CliInputError("--at is required; this gate never reads the clock itself");
  if (Number.isNaN(Date.parse(raw))) throw new CliInputError(`--at must be a parseable timestamp, got "${raw}"`);
  return raw;
}

function printPlacementReport(result: HandoffPlacementResult): void {
  console.log(
    `${result.handoffsChecked} hand-off(s) checked against ${result.placementsChecked} placement(s): ${result.placed} placed in time, ${result.awaitingPlacement} still inside their declared service level.`,
  );
  for (const finding of result.findings) {
    console.log(`  [${finding.kind}] ${finding.handoffId}${finding.subjectId ? ` (subject ${finding.subjectId})` : ""} — ${finding.message}`);
  }
  if (result.ok) console.log("Hand-off placement: satisfied.");
  else if (result.reason === "handoffs-unplaced") console.log("Hand-off placement: violated.");
  else console.log(`Hand-off placement: indeterminate (${result.reason}).`);
}

function printGroundingReport(result: GroundingResult): void {
  console.log(
    `${result.answersChecked} answer(s) checked against ${result.retainedGroundsChecked} retained ground(s): ${result.delivered} delivered, ${result.refused} refused, ${result.handedOff} handed off.`,
  );
  for (const finding of result.findings) {
    console.log(`  [${finding.kind}] ${finding.requestId} (actor ${finding.actorId}) — ${finding.message}`);
  }
  if (result.ok) console.log("Grounding: satisfied.");
  else if (result.reason === "answers-ungrounded") console.log("Grounding: violated.");
  else console.log(`Grounding: indeterminate (${result.reason}).`);
}

function printDischargeReport(result: ObligationDischargeResult): void {
  console.log(
    `${result.obligationsChecked} obligation(s) checked against ${result.proofsChecked} delivery proof(s): ${result.discharged} discharged, ${result.awaitingWindow} still inside their declared window.`,
  );
  for (const finding of result.findings) {
    const attempts = finding.attempts === undefined ? "" : ` (${finding.attempts} attempt(s))`;
    console.log(`  [${finding.kind}] ${finding.obligationId}${attempts} — ${finding.message}`);
  }
  if (result.ok) console.log("Obligation discharge: satisfied.");
  else if (result.reason === "obligations-breached") console.log("Obligation discharge: violated.");
  else console.log(`Obligation discharge: indeterminate (${result.reason}).`);
}

/**
 * The one mapping every gate shares: a real violation is `1`; an
 * indeterminate reason — nothing, or not everything, was compared — is `2`,
 * never `0` and never conflated with a violation.
 */
function exitCodeFor(ok: boolean, reason: string | undefined, violationReason: string): number {
  if (ok) return 0;
  return reason === violationReason ? 1 : 2;
}

function runHandoffPlacement(argv: string[]): number {
  const args = parseArgs(argv, ["--at"]);
  if (args.help) {
    console.log(PLACEMENT_USAGE);
    return 0;
  }
  const [handoffsArg, placementsArg, ...extra] = args.positional;
  if (handoffsArg === undefined) throw new CliInputError("handoffs-file is required");
  if (placementsArg === undefined) throw new CliInputError("placements-file is required");
  if (extra.length > 0) throw new CliInputError(`unexpected extra argument "${extra[0]}"`);
  const at = parseAt(args.options.get("--at"));

  const handoffsFile = resolve(handoffsArg);
  const placementsFile = resolve(placementsArg);
  console.log(`Hand-offs file: ${handoffsFile}`);
  console.log(`Placements file: ${placementsFile}`);

  const handoffs = loadRecords("handoffs-file", handoffsFile, validateHandoffRecords);
  if (handoffs === undefined) return 2;
  const placements = loadRecords("placements-file", placementsFile, validatePlacementRecords);
  if (placements === undefined) return 2;

  const result = checkHandoffPlacement(handoffs, placements, at);
  printPlacementReport(result);
  return exitCodeFor(result.ok, result.reason, "handoffs-unplaced");
}

function runGrounding(argv: string[]): number {
  const args = parseArgs(argv, []);
  if (args.help) {
    console.log(GROUNDING_USAGE);
    return 0;
  }
  const [answersArg, retainedArg, ...extra] = args.positional;
  if (answersArg === undefined) throw new CliInputError("answers-file is required");
  if (retainedArg === undefined) throw new CliInputError("retained-grounds-file is required");
  if (extra.length > 0) throw new CliInputError(`unexpected extra argument "${extra[0]}"`);

  const answersFile = resolve(answersArg);
  const retainedFile = resolve(retainedArg);
  console.log(`Answers file: ${answersFile}`);
  console.log(`Retained grounds file: ${retainedFile}`);

  const answers = loadRecords("answers-file", answersFile, validateAnswerRecords);
  if (answers === undefined) return 2;
  const retained = loadRecords("retained-grounds-file", retainedFile, validateRetainedGrounds);
  if (retained === undefined) return 2;

  const result = checkGrounding(answers, retained);
  printGroundingReport(result);
  return exitCodeFor(result.ok, result.reason, "answers-ungrounded");
}

function runObligationDischarge(argv: string[]): number {
  const args = parseArgs(argv, ["--at"]);
  if (args.help) {
    console.log(DISCHARGE_USAGE);
    return 0;
  }
  const [obligationsArg, proofsArg, ...extra] = args.positional;
  if (obligationsArg === undefined) throw new CliInputError("obligations-file is required");
  if (proofsArg === undefined) throw new CliInputError("proofs-file is required");
  if (extra.length > 0) throw new CliInputError(`unexpected extra argument "${extra[0]}"`);
  const at = parseAt(args.options.get("--at"));

  const obligationsFile = resolve(obligationsArg);
  const proofsFile = resolve(proofsArg);
  console.log(`Obligations file: ${obligationsFile}`);
  console.log(`Delivery proofs file: ${proofsFile}`);

  const obligations = loadRecords("obligations-file", obligationsFile, validateObligationRecords);
  if (obligations === undefined) return 2;
  const proofs = loadRecords("proofs-file", proofsFile, validateDeliveryProofs);
  if (proofs === undefined) return 2;

  const result = checkObligationDischarge(obligations, proofs, at);
  printDischargeReport(result);
  return exitCodeFor(result.ok, result.reason, "obligations-breached");
}

/**
 * Exported (unlike a typical CLI `main`) so `cli.test.ts` can exercise the
 * whole argv-to-exit-code contract directly, against real `mkdtemp` temp
 * directories, without spawning a subprocess per case. Takes `argv` as a
 * parameter rather than reading `process.argv` itself for exactly that
 * reason — `run()` below is the only caller that reads the real
 * `process.argv`.
 */
export function main(argv: string[]): number {
  const first = argv[0];

  // An EXPLICITLY requested `--help` is a run that did exactly what was
  // asked, so it is `0`. A BARE invocation is not: no gate was selected, so
  // nothing was checked, and reporting that clean is the precise fail-open
  // shape this repository's own contribution guide forbids ("a check that
  // cannot run must fail (`2`), never pass (`0`)"). A CI step with a dropped
  // argument, a wrapper that loses `$1`, or a gate renamed out from under
  // its caller all arrive here, and all three must go red rather than green
  // on the strength of having examined nothing. Usage still prints — on
  // stderr, because it is now a diagnostic rather than the thing asked for.
  if (first === "--help" || first === "-h") {
    console.log(USAGE);
    return 0;
  }
  if (first === undefined) {
    console.error("giver-check: no gate selected, so nothing was checked.");
    console.error(`\n${USAGE}`);
    return 2;
  }
  if (first === "handoff-placement") return runHandoffPlacement(argv.slice(1));
  if (first === "grounding") return runGrounding(argv.slice(1));
  if (first === "obligation-discharge") return runObligationDischarge(argv.slice(1));
  throw new CliInputError(`unknown gate "${first}"; expected one of ${GATES.join(", ")}`);
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`giver-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`giver-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      process.exitCode = 2;
    }
  }
}

/**
 * `npm install` publishes `bin` entries as symlinks, so comparing
 * `process.argv[1]` to `import.meta.url` without resolving symlinks on both
 * sides fails the moment this file is invoked the only way it ships — as an
 * installed CLI — and fails silently: `run()` never fires, nothing prints,
 * and the exit code is 0. Resolving both real paths is the fix.
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
