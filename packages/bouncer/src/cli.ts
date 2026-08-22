#!/usr/bin/env node
/**
 * `bouncer-check` — one bin, three gates, dispatched on `argv[0]` matching a
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
 * EXIT CODES — the contract a consumer's CI depends on (this repository's own
 * contribution guide, "Gate CLIs exit `0` clean, `1` findings, `2` could not
 * run"):
 *
 *   0 — ran cleanly against a non-empty record set and found nothing.
 *   1 — ran cleanly and found at least one real violation.
 *   2 — could not run. Kept strictly distinct from `1`, because "I checked and
 *       it is fine" and "I never checked" are different answers, and a gate
 *       that reports the second as the first is worse than no gate.
 *
 * `2` is genuinely reachable here, on every subcommand, and each route is
 * tested:
 *   - a record store that cannot be read — missing file, unreadable file, a
 *     directory where a file was named, invalid JSON, or JSON that does not
 *     validate against this package's own schema;
 *   - nothing to scan — an empty record set, which is not a clean run, it is a
 *     run that examined nothing;
 *   - A PROVIDER THAT COULD NOT BE REACHED. This is the one this package was
 *     built around: a provider of record that did not answer means the
 *     comparison did not happen, and the local view is exactly what must not
 *     be reported on its own. `authority-reconciliation` exits `2` for it,
 *     never `0` and never `1` — see `checkAuthorityReconciliation`'s own doc
 *     comment for why it is not a denial either;
 *   - NO GATE SELECTED AT ALL. A bare `bouncer-check` with no subcommand is a
 *     run that never happened, and it exits `2`, not `0` — see `main()`'s own
 *     comment for why an explicitly requested `--help` is the one
 *     argument-shaped `0` here and a dropped argument is not.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkAuthorityReconciliation,
  checkDelegationCeiling,
  checkProviderContract,
  type AuthorityReconciliationResult,
  type DelegationCeilingResult,
  type ProviderContractResult,
} from "./contract.js";
import {
  validateAdapterMappings,
  validateDelegatedActors,
  validateGrants,
  validateProviderAssertions,
  validateProviderShapes,
} from "./schema.js";
import type { ValidationResult } from "./validation.js";

const USAGE = `Usage: bouncer-check <gate> [arguments]

Gates:
  authority-reconciliation <grants-file> <provider-assertions-file> --at <timestamp>
      Fails when a live grant is revoked upstream, is not backed by its
      provider of record at all, or has passed its own declared expiry.
      Exits 2 — never 0 — when a provider could not be reached, because a
      comparison that did not happen is not a comparison that passed.

  delegation-ceiling <delegated-actors-file>
      Fails when a machine actor has no declared spend ceiling, has an
      undeclared unlimited one, has an amount with no currency (or a currency
      with no amount), names no responsible human, or has an empty tool scope.

  provider-contract <adapter-mappings-file> <provider-shapes-file>
      Fails when an adapter reads a field or recognises an event the provider
      no longer declares, requires a field the provider only sometimes sends,
      or ignores an event the provider does emit.

Options:
  --help    Print this message and exit 0. Also available per gate.

Exit codes: 0 = clean, 1 = at least one finding, 2 = could not run (bad
arguments, a missing/unreadable/unparseable/invalid file, an empty record set,
an unreachable or unobserved provider, or no gate selected at all).
`;

const RECONCILIATION_USAGE = `Usage: bouncer-check authority-reconciliation <grants-file> <provider-assertions-file> --at <timestamp>

  grants-file               JSON array of Grant objects: the authority that is live in your own system right now. Required, and may not be empty — nothing to reconcile is not a clean reconciliation.
  provider-assertions-file  JSON array of ProviderAssertion objects: one observation per provider of record, each stating whether it was reachable and, if so, what it still backs. Required.
  --at <timestamp>          The instant to judge expiry against. Required, with no default: this gate never reads the clock itself, so the same inputs always produce the same answer.

Exit codes: 0 = every live grant traces to a provider that still backs it, 1 = at least one does not, 2 = could not run (including any provider that could not be reached or was never observed).
`;

const DELEGATION_USAGE = `Usage: bouncer-check delegation-ceiling <delegated-actors-file>

  delegated-actors-file  JSON array of DelegatedActor objects — the same record shape ./agent's runtime guards take. Required.

An absent monetaryLimitAmount is always a finding. An explicit null one is a finding unless the record also carries "unlimitedSpendIsDeclared": true — saying so out loud, rather than by omission. There is no unlimited default anywhere in this package.

Exit codes: 0 = every machine actor's authority is bounded and attributable, 1 = at least one is not, 2 = could not run.
`;

const PROVIDER_CONTRACT_USAGE = `Usage: bouncer-check provider-contract <adapter-mappings-file> <provider-shapes-file>

  adapter-mappings-file  JSON array of AdapterMapping objects: what each adapter reads and which events it recognises. Required.
  provider-shapes-file   JSON array of ProviderShape objects: the provider's own declared shape, as you transcribed it. Required. This package never fetches it — a gate that needed network access and credentials could not run where a gate belongs.

Exit codes: 0 = every mapping still matches its provider's declared shape, 1 = at least one has drifted, 2 = could not run (including a mapping whose provider shape was not supplied).
`;

const GATES = ["authority-reconciliation", "delegation-ceiling", "provider-contract"] as const;

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
 * this package that reads anything off disk — every checker in `contract.ts`
 * is pure.
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

/** `--at 2026-08-22T00:00:00.000Z`. No default: this gate never reads the clock itself. */
function parseAt(raw: string | undefined): string {
  if (raw === undefined) {
    throw new CliInputError("--at is required; this gate never reads the clock itself, so the instant it judges against must be stated");
  }
  if (Number.isNaN(Date.parse(raw))) throw new CliInputError(`--at must be a parseable timestamp, got "${raw}"`);
  return raw;
}

function printReconciliationReport(result: AuthorityReconciliationResult): void {
  console.log(`${result.grantsChecked} live grant(s) checked against ${result.providersChecked} provider observation(s).`);
  console.log(`Unreconciled grant surface: ${result.unreconciledGrantSurface}. Grants nothing could be learned about: ${result.unverifiableGrants}.`);
  for (const finding of result.findings) {
    console.log(`  [${finding.kind}] ${finding.grantId} (actor ${finding.actorId}, subject ${finding.subjectId}, provider ${finding.providerId}) — ${finding.message}`);
  }
  if (result.ok) console.log("Authority reconciliation: satisfied.");
  else if (result.reason === "unreconciled-grants") console.log("Authority reconciliation: violated.");
  else console.log(`Authority reconciliation: indeterminate (${result.reason}).`);
}

function printDelegationReport(result: DelegationCeilingResult): void {
  console.log(`${result.actorsChecked} delegated machine actor(s) checked.`);
  for (const finding of result.findings) {
    const responsible = finding.responsibleHumanId ? ` (responsible ${finding.responsibleHumanId})` : "";
    console.log(`  [${finding.kind}] ${finding.agentIdentityId}${responsible} — ${finding.message}`);
  }
  if (result.ok) console.log("Delegation ceiling: satisfied.");
  else if (result.reason === "unbounded-delegation") console.log("Delegation ceiling: violated.");
  else console.log(`Delegation ceiling: indeterminate (${result.reason}).`);
}

function printProviderContractReport(result: ProviderContractResult): void {
  console.log(`${result.mappingsChecked} adapter mapping(s) checked against ${result.shapesChecked} declared provider shape(s).`);
  for (const finding of result.findings) {
    console.log(`  [${finding.kind}] ${finding.adapterId} / ${finding.providerId} / ${finding.subject} — ${finding.message}`);
  }
  if (result.ok) console.log("Provider contract: satisfied.");
  else if (result.reason === "mapping-drift") console.log("Provider contract: violated.");
  else console.log(`Provider contract: indeterminate (${result.reason}).`);
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

function runAuthorityReconciliation(argv: string[]): number {
  const args = parseArgs(argv, ["--at"]);
  if (args.help) {
    console.log(RECONCILIATION_USAGE);
    return 0;
  }
  const [grantsArg, assertionsArg, ...extra] = args.positional;
  if (grantsArg === undefined) throw new CliInputError("grants-file is required");
  if (assertionsArg === undefined) throw new CliInputError("provider-assertions-file is required");
  if (extra.length > 0) throw new CliInputError(`unexpected extra argument "${extra[0]}"`);
  const at = parseAt(args.options.get("--at"));

  const grantsFile = resolve(grantsArg);
  const assertionsFile = resolve(assertionsArg);
  console.log(`Grants file: ${grantsFile}`);
  console.log(`Provider assertions file: ${assertionsFile}`);

  const grants = loadRecords("grants-file", grantsFile, validateGrants);
  if (grants === undefined) return 2;
  const assertions = loadRecords("provider-assertions-file", assertionsFile, validateProviderAssertions);
  if (assertions === undefined) return 2;

  const result = checkAuthorityReconciliation(grants, assertions, at);
  printReconciliationReport(result);
  return exitCodeFor(result.ok, result.reason, "unreconciled-grants");
}

function runDelegationCeiling(argv: string[]): number {
  const args = parseArgs(argv, []);
  if (args.help) {
    console.log(DELEGATION_USAGE);
    return 0;
  }
  const [actorsArg, ...extra] = args.positional;
  if (actorsArg === undefined) throw new CliInputError("delegated-actors-file is required");
  if (extra.length > 0) throw new CliInputError(`unexpected extra argument "${extra[0]}"`);

  const actorsFile = resolve(actorsArg);
  console.log(`Delegated actors file: ${actorsFile}`);

  const actors = loadRecords("delegated-actors-file", actorsFile, validateDelegatedActors);
  if (actors === undefined) return 2;

  const result = checkDelegationCeiling(actors);
  printDelegationReport(result);
  return exitCodeFor(result.ok, result.reason, "unbounded-delegation");
}

function runProviderContract(argv: string[]): number {
  const args = parseArgs(argv, []);
  if (args.help) {
    console.log(PROVIDER_CONTRACT_USAGE);
    return 0;
  }
  const [mappingsArg, shapesArg, ...extra] = args.positional;
  if (mappingsArg === undefined) throw new CliInputError("adapter-mappings-file is required");
  if (shapesArg === undefined) throw new CliInputError("provider-shapes-file is required");
  if (extra.length > 0) throw new CliInputError(`unexpected extra argument "${extra[0]}"`);

  const mappingsFile = resolve(mappingsArg);
  const shapesFile = resolve(shapesArg);
  console.log(`Adapter mappings file: ${mappingsFile}`);
  console.log(`Provider shapes file: ${shapesFile}`);

  const mappings = loadRecords("adapter-mappings-file", mappingsFile, validateAdapterMappings);
  if (mappings === undefined) return 2;
  const shapes = loadRecords("provider-shapes-file", shapesFile, validateProviderShapes);
  if (shapes === undefined) return 2;

  const result = checkProviderContract(mappings, shapes);
  printProviderContractReport(result);
  return exitCodeFor(result.ok, result.reason, "mapping-drift");
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

  // An EXPLICITLY requested `--help` is a run that did exactly what was asked,
  // so it is `0`. A BARE invocation is not: no gate was selected, so nothing
  // was checked, and reporting that clean is the precise fail-open shape this
  // repository's own contribution guide forbids ("a check that cannot run must
  // fail (`2`), never pass (`0`)"). A CI step with a dropped argument, a
  // wrapper that loses `$1`, or a gate renamed out from under its caller all
  // arrive here, and all three must go red rather than green on the strength
  // of having examined nothing. Usage still prints — on stderr, because it is
  // now a diagnostic rather than the thing asked for.
  if (first === "--help" || first === "-h") {
    console.log(USAGE);
    return 0;
  }
  if (first === undefined) {
    console.error("bouncer-check: no gate selected, so nothing was checked.");
    console.error(`\n${USAGE}`);
    return 2;
  }
  if (first === "authority-reconciliation") return runAuthorityReconciliation(argv.slice(1));
  if (first === "delegation-ceiling") return runDelegationCeiling(argv.slice(1));
  if (first === "provider-contract") return runProviderContract(argv.slice(1));
  throw new CliInputError(`unknown gate "${first}"; expected one of ${GATES.join(", ")}`);
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`bouncer-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`bouncer-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      process.exitCode = 2;
    }
  }
}

/**
 * `npm install` publishes `bin` entries as symlinks, so comparing
 * `process.argv[1]` to `import.meta.url` without resolving symlinks on both
 * sides fails the moment this file is invoked the only way it ships — as an
 * installed CLI — and fails silently: `run()` never fires, nothing prints, and
 * the exit code is 0. Resolving both real paths is the fix.
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
