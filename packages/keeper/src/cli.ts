#!/usr/bin/env node
/**
 * `keeper-check` — one bin, three gates, dispatched on `argv[0]` matching a
 * subcommand name EXACTLY.
 *
 * Dispatch is on `argv[0]`, never on `basename(process.argv[1])`. A bin-name
 * dispatch would see `cli.js` wherever this gate is invoked by its compiled
 * path — which is exactly how this repository's own `npm run check` invokes
 * other packages' gates — and would silently run the wrong command, or none.
 *
 * Presentation only: parse argv, load JSON files, run the pure checkers in
 * `contract.ts`, print a report, pick an exit code. Every decision worth
 * testing lives in `contract.ts` and is tested there directly, against plain
 * values, with no filesystem involved.
 *
 * WHAT THIS CLI READS, AND WHAT IT NEVER READS
 * ---------------------------------------------
 * Record files, supplied by the consumer, holding opaque ids and
 * consumer-defined class labels. Never the material itself. A holding set
 * can be handed to this gate with no authored text, no saved work and no
 * belief's own wording passing through it — which is what makes it safe to
 * run in CI at all. This CLI never writes anything, anywhere: the store is a
 * host-supplied port, because git cannot delete and this role must.
 *
 * EXIT CODES — the contract a consumer's CI depends on (this repository's own
 * contribution guide, "Gate CLIs exit `0` clean, `1` findings, `2` could not
 * run"):
 *
 *   0 — ran cleanly against a non-empty record set and found nothing.
 *   1 — ran cleanly and found at least one real violation.
 *   2 — could not run. Kept strictly distinct from `1`, because "I checked
 *       and it is fine" and "I never checked" are different answers and a
 *       gate that reports the second as the first is worse than no gate.
 *
 * `2` is genuinely reachable here, on every subcommand, and each route is
 * tested:
 *   - a record store that cannot be read — missing file, unreadable file, a
 *     directory where a file was named, invalid JSON, or JSON that does not
 *     validate against this package's own schema;
 *   - nothing to scan — an empty holding set, which is not a clean run, it is
 *     a run that examined nothing;
 *   - AN ANSWER THAT COULD NOT BE ESTABLISHED. A provenance the store could
 *     not resolve, a disclosure route that could not say whether the person
 *     can see the item, an item whose class the declared schedule never
 *     covered, or a deletion nobody observed the effect of. This is the route
 *     that matters most in this package: its gates output judgements, and "I
 *     could not check" must never round to satisfied;
 *   - a required declared value that was not supplied — `--at`, which has no
 *     default anywhere in this package. Reading the clock here would make
 *     every run unrepeatable and whether a record is 400 days into a 90-day
 *     schedule would depend on when someone happened to look;
 *   - NO GATE SELECTED AT ALL. A bare `keeper-check` with no subcommand is a
 *     run that never happened, and it exits `2`, not `0` — see `main()`'s own
 *     comment for why an explicitly requested `--help` is the one
 *     argument-shaped `0` here and a dropped argument is not.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DISPOSAL_VIOLATION_REASONS,
  checkAttribution,
  checkDisposal,
  checkVisibility,
  type AttributionResult,
  type DisposalResult,
  type VisibilityResult,
} from "./contract.js";
import {
  validateDeletionRecords,
  validateDisclosureRecords,
  validateHeldItems,
  validateRetentionRules,
  validateSourceEvents,
} from "./schema.js";
import { validateGiverRetainedGroundsDocument } from "./giver-record.js";
import type { ValidationResult } from "./validation.js";

const USAGE = `Usage: keeper-check <gate> [arguments]

Gates:
  attribution <items-file> <source-events-file>
      Fails when a held item names no source event, when an inferred belief
      names none, when a named event is not in the retained set, when it
      belongs to another subject, when it occurred after the item was
      already held, and when a belief constrains behaviour with no
      confirmation from the person. An item whose provenance the store could
      not resolve is unverifiable, and exits 2 rather than passing.

  visibility <items-file> <disclosures-file> <giver-retained-grounds-file>
      Fails when a held item has no disclosure route at all, when every
      route reports it hidden, when the only routes belong to a different
      person, and when it is reachable but not correctable. It also checks
      giver's retained decision grounds from its declared JSON record path;
      a grounds record with no disclosure route is a distinct finding. A
      route that could not say either way is unverifiable, and exits 2.

  disposal <items-file> <schedule-file> <deletions-file> --at <timestamp>
      Fails when an item outlived the retention its own class declared, when
      a deletion recorded as erased left the item still held, and when a
      deletion failed. An item whose class the declared schedule does not
      cover, and a deletion nobody observed the effect of, are both
      unverifiable, and exit 2 rather than passing.

Options:
  --at <timestamp>  The instant to judge against. Required where it applies,
                    with no default: a gate that read its own clock could
                    never be replayed, and whether a record has outlived its
                    schedule would depend on when someone happened to look.
  --help            Print this message and exit 0. Also available per gate.

Exit codes: 0 = clean, 1 = at least one finding, 2 = could not run (bad
arguments, a missing/unreadable/unparseable/invalid file, an empty record
set, or an answer that could not be established).
`;

const ATTRIBUTION_USAGE = `Usage: keeper-check attribution <items-file> <source-events-file>

  items-file          JSON array of HeldItem objects. Required. An empty HOLDING set exits 2 — it is a run that examined nothing.
  source-events-file  JSON array of SourceEvent objects — the events the consumer says it still retains. Required. May be an empty array; every item then names an event that is not retained, which is a real finding.

An inferred belief that names no source event is the central finding here. A
belief that constrains behaviour with no confirmation from the person is the
boundary rule: an instruction constrains us, an understanding only informs
us, and a belief that crossed that line without being confirmed rests on
nothing the person did.

Exit codes: 0 = every held item traces to something they did, 1 = at least one does not, 2 = could not run (including an item whose provenance the store could not resolve).
`;

const VISIBILITY_USAGE = `Usage: keeper-check visibility <items-file> <disclosures-file> <giver-retained-grounds-file>

  items-file        JSON array of HeldItem objects. Required. An empty HOLDING set exits 2.
  disclosures-file  JSON array of DisclosureRecord objects — where, if anywhere, each item is reachable. Required. May be an empty array; every item is then undisclosed, which is a real finding.
  giver-retained-grounds-file  The versioned retained-grounds JSON document at giver's declared record path. Required. Its grounds are not keeper holdings, but must be reachable by the person each explains a decision about.

Routes are joined on the SUBJECT, not just the item: a route pointing at a
different person is not visibility. Being able to read something is not being
able to correct it, and this gate checks both.

Exit codes: 0 = every held item is reachable and correctable by the person it is about, 1 = at least one is not, 2 = could not run (including a route that could not say either way).
`;

const DISPOSAL_USAGE = `Usage: keeper-check disposal <items-file> <schedule-file> <deletions-file> --at <timestamp>

  items-file       JSON array of HeldItem objects. Required. An empty HOLDING set exits 2.
  schedule-file    JSON array of RetentionRule objects — the consumer's own declared retention, per holding class. Required. May be an empty array; every item's class is then undeclared, which is unverifiable rather than clean.
  deletions-file   JSON array of DeletionRecord objects. Required. May be an empty array. A deletion naming an item that is NOT in the held set is the success case and is not a finding.
  --at <timestamp> The instant to judge against. Required, with no default.

This gate compares the declaration against the data. Checking only that a
retention policy EXISTS passes while records sit far past it, because nothing
ever read the records.

Exit codes: 0 = nothing outlived its declared retention and no deletion left residue, 1 = at least one did, 2 = could not run (including an item whose class the schedule never declared).
`;

const GATES = ["attribution", "visibility", "disposal"] as const;

/** Exported for `cli.test.ts` — anything wrong with the arguments themselves always maps to exit code 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  positional: string[];
  options: Map<string, string>;
  help: boolean;
}

/**
 * One argv parser for all three gates. `--name value` and `--name=value` are
 * both accepted; an unknown flag is a `CliInputError`, never a silently
 * ignored argument — a typo in a flag that carries a required declared value
 * must not read as that value being absent by choice.
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
 * store's condition, and it is exactly the "could not run" state this gate's
 * `2` exists for. Reporting it through the normal return path rather than an
 * exception is what lets `main()` itself be observed returning `2` for it — a
 * decline path nothing ever exercises is a decline path nobody knows works.
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
 * error comes back as `{ ok: false, detail }`. This CLI is the only place in
 * this package that touches the filesystem at all — every checker in
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
 * that is missing, unreadable, unparseable, or schema-invalid never reaches a
 * checker at all: it is "could not run", decided here.
 */
function loadRecords<T>(label: string, path: string, validate: (value: unknown) => ValidationResult<T>): T | undefined {
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

/** `--at 2026-08-22T12:00:00.000Z`. No default: this package never reads the clock, so a run is replayable and drift is a fact rather than a function of when someone looked. */
function parseAt(raw: string | undefined): string {
  if (raw === undefined) throw new CliInputError("--at is required; this gate never reads the clock itself");
  if (Number.isNaN(Date.parse(raw))) throw new CliInputError(`--at must be a parseable timestamp, got "${raw}"`);
  return raw;
}

function printFindings(findings: readonly { kind: string; itemId: string; subjectId?: string; message: string }[]): void {
  for (const finding of findings) {
    console.log(`  [${finding.kind}] ${finding.itemId}${finding.subjectId ? ` (subject ${finding.subjectId})` : ""} — ${finding.message}`);
  }
}

function printAttributionReport(result: AttributionResult): void {
  console.log(
    `${result.itemsChecked} held item(s) checked against ${result.sourceEventsChecked} retained source event(s): ${result.attributed} traced to something the person did, ${result.beliefsChecked} of them inferred beliefs.`,
  );
  printFindings(result.findings);
  if (result.ok) console.log("Attribution: satisfied.");
  else if (result.reason === "holdings-unattributed") console.log("Attribution: violated.");
  else console.log(`Attribution: indeterminate (${result.reason}).`);
}

function printVisibilityReport(result: VisibilityResult): void {
  console.log(
    `${result.itemsChecked} held item(s) and ${result.groundsChecked} retained ground(s) checked against ${result.disclosuresChecked} disclosure route(s): ${result.reachable} reachable and correctable by the person they are about.`,
  );
  printFindings(result.findings);
  if (result.ok) console.log("Visibility: satisfied.");
  else if (result.reason === "holdings-unreachable") console.log("Visibility: violated.");
  else console.log(`Visibility: indeterminate (${result.reason}).`);
}

function printDisposalReport(result: DisposalResult): void {
  console.log(
    `${result.itemsChecked} held item(s) checked against ${result.retentionRulesChecked} declared retention rule(s) and ${result.deletionsChecked} deletion record(s): ${result.withinSchedule} inside the retention their own class declared.`,
  );
  printFindings(result.findings);
  if (result.ok) console.log("Disposal: satisfied.");
  else if (DISPOSAL_VIOLATION_REASONS.includes(result.reason as (typeof DISPOSAL_VIOLATION_REASONS)[number])) console.log(`Disposal: violated (${result.reason}).`);
  else console.log(`Disposal: indeterminate (${result.reason}).`);
}

/**
 * The one mapping every gate shares: a real violation is `1`; an indeterminate
 * reason — nothing, or not everything, could be compared — is `2`, never `0`
 * and never conflated with a violation.
 *
 * Takes the violation reasons as a LIST rather than a single name because
 * `disposal` has two of them: material that outlived its schedule, and a
 * deletion that left residue. Both are real findings and both are `1`; naming
 * only one here would have quietly mapped the other to `2` and reported an
 * erasure failure as something the gate could not check.
 */
function exitCodeFor(ok: boolean, reason: string | undefined, violationReasons: readonly string[]): number {
  if (ok) return 0;
  return reason !== undefined && violationReasons.includes(reason) ? 1 : 2;
}

function runAttribution(argv: string[]): number {
  const args = parseArgs(argv, []);
  if (args.help) {
    console.log(ATTRIBUTION_USAGE);
    return 0;
  }
  const [itemsArg, eventsArg, ...extra] = args.positional;
  if (itemsArg === undefined) throw new CliInputError("items-file is required");
  if (eventsArg === undefined) throw new CliInputError("source-events-file is required");
  if (extra.length > 0) throw new CliInputError(`unexpected extra argument "${extra[0]}"`);

  const itemsFile = resolve(itemsArg);
  const eventsFile = resolve(eventsArg);
  console.log(`Held items file: ${itemsFile}`);
  console.log(`Source events file: ${eventsFile}`);

  const items = loadRecords("items-file", itemsFile, validateHeldItems);
  if (items === undefined) return 2;
  const events = loadRecords("source-events-file", eventsFile, validateSourceEvents);
  if (events === undefined) return 2;

  const result = checkAttribution(items, events);
  printAttributionReport(result);
  return exitCodeFor(result.ok, result.reason, ["holdings-unattributed"]);
}

function runVisibility(argv: string[]): number {
  const args = parseArgs(argv, []);
  if (args.help) {
    console.log(VISIBILITY_USAGE);
    return 0;
  }
  const [itemsArg, disclosuresArg, groundsArg, ...extra] = args.positional;
  if (itemsArg === undefined) throw new CliInputError("items-file is required");
  if (disclosuresArg === undefined) throw new CliInputError("disclosures-file is required");
  if (groundsArg === undefined) throw new CliInputError("giver-retained-grounds-file is required");
  if (extra.length > 0) throw new CliInputError(`unexpected extra argument "${extra[0]}"`);

  const itemsFile = resolve(itemsArg);
  const disclosuresFile = resolve(disclosuresArg);
  const groundsFile = resolve(groundsArg);
  console.log(`Held items file: ${itemsFile}`);
  console.log(`Disclosures file: ${disclosuresFile}`);
  console.log(`Giver retained grounds file: ${groundsFile}`);

  const items = loadRecords("items-file", itemsFile, validateHeldItems);
  if (items === undefined) return 2;
  const disclosures = loadRecords("disclosures-file", disclosuresFile, validateDisclosureRecords);
  if (disclosures === undefined) return 2;
  const grounds = loadRecords("giver-retained-grounds-file", groundsFile, validateGiverRetainedGroundsDocument);
  if (grounds === undefined) return 2;

  const result = checkVisibility(items, disclosures, grounds);
  printVisibilityReport(result);
  return exitCodeFor(result.ok, result.reason, ["holdings-unreachable"]);
}

function runDisposal(argv: string[]): number {
  const args = parseArgs(argv, ["--at"]);
  if (args.help) {
    console.log(DISPOSAL_USAGE);
    return 0;
  }
  const [itemsArg, scheduleArg, deletionsArg, ...extra] = args.positional;
  if (itemsArg === undefined) throw new CliInputError("items-file is required");
  if (scheduleArg === undefined) throw new CliInputError("schedule-file is required");
  if (deletionsArg === undefined) throw new CliInputError("deletions-file is required");
  if (extra.length > 0) throw new CliInputError(`unexpected extra argument "${extra[0]}"`);
  const at = parseAt(args.options.get("--at"));

  const itemsFile = resolve(itemsArg);
  const scheduleFile = resolve(scheduleArg);
  const deletionsFile = resolve(deletionsArg);
  console.log(`Held items file: ${itemsFile}`);
  console.log(`Retention schedule file: ${scheduleFile}`);
  console.log(`Deletions file: ${deletionsFile}`);

  const items = loadRecords("items-file", itemsFile, validateHeldItems);
  if (items === undefined) return 2;
  const schedule = loadRecords("schedule-file", scheduleFile, validateRetentionRules);
  if (schedule === undefined) return 2;
  const deletions = loadRecords("deletions-file", deletionsFile, validateDeletionRecords);
  if (deletions === undefined) return 2;

  const result = checkDisposal(items, schedule, deletions, at);
  printDisposalReport(result);
  return exitCodeFor(result.ok, result.reason, DISPOSAL_VIOLATION_REASONS);
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
  // argument, a wrapper that loses `$1`, or a gate renamed out from under its
  // caller all arrive here, and all three must go red rather than green on
  // the strength of having examined nothing. Usage still prints — on stderr,
  // because it is now a diagnostic rather than the thing asked for.
  if (first === "--help" || first === "-h") {
    console.log(USAGE);
    return 0;
  }
  if (first === undefined) {
    console.error("keeper-check: no gate selected, so nothing was checked.");
    console.error(`\n${USAGE}`);
    return 2;
  }
  if (first === "attribution") return runAttribution(argv.slice(1));
  if (first === "visibility") return runVisibility(argv.slice(1));
  if (first === "disposal") return runDisposal(argv.slice(1));
  throw new CliInputError(`unknown gate "${first}"; expected one of ${GATES.join(", ")}`);
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`keeper-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`keeper-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
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
