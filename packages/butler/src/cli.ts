#!/usr/bin/env node
/**
 * `butler-check` — one bin, three gates, dispatched on `argv[0]` matching a
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
 *   - a required declared value that was not supplied — the confidence
 *     floor, or the denial-invalidation policy. Neither has a default
 *     anywhere in this package, and a run missing one declines rather than
 *     inventing one of the consumer's own values.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkConfirmationCompleteness,
  checkCurrency,
  checkWithdrawalParity,
  type ConfirmationCompletenessResult,
  type CurrencyResult,
  type WithdrawalParityResult,
} from "./contract.js";
import {
  validateConfirmationRecords,
  validateInstructionUsages,
  validateIntentRecords,
  validatePreferencePaths,
  validateStandingInstructions,
} from "./schema.js";
import type { ValidationResult } from "./validation.js";

const USAGE = `Usage: butler-check <gate> [arguments]

Gates:
  confirmation-completeness <intents-file> <confirmations-file> --floor <0..1>
      Fails when an acted-on intent has no confirmation record, when it was
      acted on against a "misread" or "unclear" read-back, or when a reading
      below the declared floor was acted on with no explicit hand-off.

  currency <instructions-file> <usages-file> --invalidate-denial-on-policy-bump <true|false>
      Fails when a standing instruction was relied on past its own declared
      window, after the policy version it answered was superseded, or while
      there was no answer on record at all.

  withdrawal-parity <paths-file>
      Fails when withdrawing takes more steps than granting, demands a
      contact or an account granting did not, or is not offered at all.

Options:
  --help    Print this message and exit 0. Also available per gate.

Exit codes: 0 = clean, 1 = at least one finding, 2 = could not run (bad
arguments, a missing/unreadable/unparseable/invalid file, an empty record
set, or a required declared value that was not supplied).
`;

const CONFIRMATION_USAGE = `Usage: butler-check confirmation-completeness <intents-file> <confirmations-file> --floor <0..1>

  intents-file        JSON array of IntentRecord objects. Required.
  confirmations-file  JSON array of ConfirmationRecord objects. Required. May be an empty array — an empty CONFIRMATION set is a real, checkable state (every acted-on intent is then unconfirmed); an empty INTENT set is not, and exits 2.
  --floor <0..1>      The declared confidence floor. Required, with no default: the number below which a reading is too weak to act on is one of the consumer's own values, and this gate will not invent one.

Exit codes: 0 = every acted-on intent is accounted for, 1 = at least one is not, 2 = could not run.
`;

const CURRENCY_USAGE = `Usage: butler-check currency <instructions-file> <usages-file> --invalidate-denial-on-policy-bump <true|false>

  instructions-file  JSON array of StandingInstruction objects. Required.
  usages-file        JSON array of InstructionUsage objects — one entry per occasion an instruction was actually relied on. Required.
  --invalidate-denial-on-policy-bump <true|false>
                     Whether a policy-version bump also invalidates a stored denial. Required, with no default in either direction: that is a jurisdiction judgment this package does not make.

Exit codes: 0 = every usage relied on a current answer, 1 = at least one did not, 2 = could not run.
`;

const WITHDRAWAL_USAGE = `Usage: butler-check withdrawal-parity <paths-file>

  paths-file  JSON array of PreferencePath objects: for one surface and one topic, the measured cost of the grant route and of the withdraw route. Required.

Exit codes: 0 = withdrawing is no harder than granting anywhere, 1 = somewhere it is, 2 = could not run.
`;

const GATES = ["confirmation-completeness", "currency", "withdrawal-parity"] as const;

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

/** `--floor 0.8`. No default: a missing or unparseable floor is a decline, never an assumed number. */
function parseFloor(raw: string | undefined): number {
  if (raw === undefined) throw new CliInputError("--floor is required; this gate has no default confidence floor");
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new CliInputError(`--floor must be a number between 0 and 1 inclusive, got "${raw}"`);
  }
  return value;
}

/** Exactly `true` or `false`. No default in either direction, and no truthiness: "yes", "1" and "" are all input errors. */
function parseBooleanFlag(name: string, raw: string | undefined): boolean {
  if (raw === undefined) throw new CliInputError(`${name} is required; this gate has no default in either direction`);
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new CliInputError(`${name} must be exactly "true" or "false", got "${raw}"`);
}

function printConfirmationReport(result: ConfirmationCompletenessResult): void {
  console.log(
    `${result.intentsChecked} intent(s) checked against ${result.confirmationsChecked} confirmation(s), floor ${result.floorApplied}.`,
  );
  for (const finding of result.findings) {
    console.log(`  [${finding.kind}] ${finding.intentId}${finding.actorId ? ` (actor ${finding.actorId})` : ""} — ${finding.message}`);
  }
  if (result.ok) console.log("Confirmation completeness: satisfied.");
  else if (result.reason === "unconfirmed-intents") console.log("Confirmation completeness: violated.");
  else console.log(`Confirmation completeness: indeterminate (${result.reason}).`);
}

function printCurrencyReport(result: CurrencyResult): void {
  console.log(`${result.instructionsChecked} standing instruction(s) checked against ${result.usagesChecked} usage(s).`);
  for (const finding of result.findings) {
    console.log(`  [${finding.kind}] ${finding.instructionId} (actor ${finding.actorId}, used ${finding.usedAt}) — ${finding.message}`);
  }
  if (result.ok) console.log("Currency: satisfied.");
  else if (result.reason === "stale-instructions-used") console.log("Currency: violated.");
  else console.log(`Currency: indeterminate (${result.reason}).`);
}

function printWithdrawalReport(result: WithdrawalParityResult): void {
  console.log(`${result.pathsChecked} preference path(s) checked.`);
  for (const finding of result.findings) {
    console.log(`  [${finding.kind}] ${finding.surfaceId} / ${finding.topic} — ${finding.message}`);
  }
  if (result.ok) console.log("Withdrawal parity: satisfied.");
  else if (result.reason === "withdrawal-harder-than-granting") console.log("Withdrawal parity: violated.");
  else console.log(`Withdrawal parity: indeterminate (${result.reason}).`);
}

/**
 * The one mapping every gate shares: a real violation is `1`; an
 * indeterminate reason — nothing was compared — is `2`, never `0` and never
 * conflated with a violation.
 */
function exitCodeFor(ok: boolean, reason: string | undefined, violationReason: string): number {
  if (ok) return 0;
  return reason === violationReason ? 1 : 2;
}

function runConfirmationCompleteness(argv: string[]): number {
  const args = parseArgs(argv, ["--floor"]);
  if (args.help) {
    console.log(CONFIRMATION_USAGE);
    return 0;
  }
  const [intentsArg, confirmationsArg, ...extra] = args.positional;
  if (intentsArg === undefined) throw new CliInputError("intents-file is required");
  if (confirmationsArg === undefined) throw new CliInputError("confirmations-file is required");
  if (extra.length > 0) throw new CliInputError(`unexpected extra argument "${extra[0]}"`);
  const minimumConfidence = parseFloor(args.options.get("--floor"));

  const intentsFile = resolve(intentsArg);
  const confirmationsFile = resolve(confirmationsArg);
  console.log(`Intents file: ${intentsFile}`);
  console.log(`Confirmations file: ${confirmationsFile}`);

  const intents = loadRecords("intents-file", intentsFile, validateIntentRecords);
  if (intents === undefined) return 2;
  const confirmations = loadRecords("confirmations-file", confirmationsFile, validateConfirmationRecords);
  if (confirmations === undefined) return 2;

  const result = checkConfirmationCompleteness(intents, confirmations, { minimumConfidence });
  printConfirmationReport(result);
  return exitCodeFor(result.ok, result.reason, "unconfirmed-intents");
}

function runCurrency(argv: string[]): number {
  const args = parseArgs(argv, ["--invalidate-denial-on-policy-bump"]);
  if (args.help) {
    console.log(CURRENCY_USAGE);
    return 0;
  }
  const [instructionsArg, usagesArg, ...extra] = args.positional;
  if (instructionsArg === undefined) throw new CliInputError("instructions-file is required");
  if (usagesArg === undefined) throw new CliInputError("usages-file is required");
  if (extra.length > 0) throw new CliInputError(`unexpected extra argument "${extra[0]}"`);
  const invalidateDenialOnPolicyBump = parseBooleanFlag(
    "--invalidate-denial-on-policy-bump",
    args.options.get("--invalidate-denial-on-policy-bump"),
  );

  const instructionsFile = resolve(instructionsArg);
  const usagesFile = resolve(usagesArg);
  console.log(`Instructions file: ${instructionsFile}`);
  console.log(`Usages file: ${usagesFile}`);

  const instructions = loadRecords("instructions-file", instructionsFile, validateStandingInstructions);
  if (instructions === undefined) return 2;
  const usages = loadRecords("usages-file", usagesFile, validateInstructionUsages);
  if (usages === undefined) return 2;

  const result = checkCurrency(instructions, usages, { invalidateDenialOnPolicyBump });
  printCurrencyReport(result);
  return exitCodeFor(result.ok, result.reason, "stale-instructions-used");
}

function runWithdrawalParity(argv: string[]): number {
  const args = parseArgs(argv, []);
  if (args.help) {
    console.log(WITHDRAWAL_USAGE);
    return 0;
  }
  const [pathsArg, ...extra] = args.positional;
  if (pathsArg === undefined) throw new CliInputError("paths-file is required");
  if (extra.length > 0) throw new CliInputError(`unexpected extra argument "${extra[0]}"`);

  const pathsFile = resolve(pathsArg);
  console.log(`Paths file: ${pathsFile}`);

  const paths = loadRecords("paths-file", pathsFile, validatePreferencePaths);
  if (paths === undefined) return 2;

  const result = checkWithdrawalParity(paths);
  printWithdrawalReport(result);
  return exitCodeFor(result.ok, result.reason, "withdrawal-harder-than-granting");
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
  if (first === undefined || first === "--help" || first === "-h") {
    console.log(USAGE);
    return 0;
  }
  if (first === "confirmation-completeness") return runConfirmationCompleteness(argv.slice(1));
  if (first === "currency") return runCurrency(argv.slice(1));
  if (first === "withdrawal-parity") return runWithdrawalParity(argv.slice(1));
  throw new CliInputError(`unknown gate "${first}"; expected one of ${GATES.join(", ")}`);
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`butler-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`butler-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
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
