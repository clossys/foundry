#!/usr/bin/env node
/**
 * `writer-check` — the CLI for `checkCopyTraceability` — AND, in this same
 * file and under this SAME `writer-check` bin, a subcommand
 * (`writer-check addressability`, dispatched on `argv[0] === "addressability"`
 * before any of the existing argument parsing below runs — see the bottom
 * of this file), `checkAddressability`: is user-facing prose resolved from
 * the copy registry by id, rather than typed inline? A stricter, DIFFERENT
 * question from traceability — see `addressability.ts`'s top doc comment
 * for the full split. Deliberately NOT merged into the default command's
 * own exit code: traceability's own fixtures/tests are built entirely
 * around bare literal assignments (a registered string, an unregistered
 * one, a `copy-gate:ignore` marker, a `copy:<id>` citation) — exactly the
 * shapes addressability treats as either a violation (an attribute/
 * text-node literal) or an unclassifiable position (a bare assignment,
 * position 3 — see `addressability.ts`), by design and on purpose.
 * Combining the two into one number would make the default command's own
 * "clean pass" fixtures structurally unwritable (a literal a
 * registered-text match needs to exist for traceability to prove anything
 * is exactly a literal addressability cannot confirm is safe) rather than
 * genuinely complementary. A SEPARATE `bin` entry pointing at this same
 * compiled file was rejected for the identical reason `@vespeneventures/ui`
 * never does that: this repository's own root `package.json` invokes every
 * gate by its COMPILED PATH (`node packages/ui/dist/tokens/contrast-cli.js`,
 * `node packages/controller/dist/cli.js`, ...), never by installed `bin`
 * name — a second `bin` entry pointing at the same file is invisible to
 * that invocation style, and worse, silently falls through to the OTHER
 * command rather than erroring. An explicit `argv[0]` subcommand is
 * reachable however the file is invoked, by path or by name. Both
 * commands are still presentation-only wrappers over this package's pure
 * gates, both still print every skip/exclusion count unconditionally, and
 * both still use the identical three-state exit-code contract described
 * below — same shape, same file, same bin, two subcommands, two numbers,
 * matching `@vespeneventures/strategy`'s `strategy-facts-check` shape
 * closely, deliberately: same argument order (the thing being checked
 * FOR, then the thing being checked, where applicable), same `--help`,
 * same `CliInputError` split between "bad arguments" and "ran, found
 * something wrong".
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
 * A third subcommand, `locale-coverage`, wires `checkLocaleCoverage`
 * (`./locale-coverage.ts`) in with the identical shape again: parse argv,
 * load a JSON registries file, run the pure check, print a report, pick an
 * exit code — see `runLocaleCoverage`'s own doc comment below.
 * `checkLocaleCoverage` already defines its own caller contract for turning
 * a `LocaleCoverageReport` into this package's usual three-state exit code
 * (see `LocaleCoverageReport.complete`'s own doc comment in
 * `locale-coverage.ts`); `runLocaleCoverage` applies that mapping exactly,
 * rather than inventing a second one. `main()` dispatches to it only when
 * `argv[0]` is exactly `"locale-coverage"` — checked alongside
 * `"voice-derivation-coverage"`, before either falls through to the
 * original `record-file` handling — so this, too, is purely additive to the
 * argv contract.
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
import {
  checkAddressability,
  scanAddressabilitySources,
  type AddressabilityGateResult,
  type AddressabilityScanResult,
} from "./addressability.js";
import { checkCopyTraceability, type CopyGateResult } from "./copy-gate.js";
import { checkLocaleCoverage, type LocaleCoverageReport } from "./locale-coverage.js";
import { readCopyRecord } from "./registry.js";
import { scanCopySourceTree, type ScanResult } from "./scan.js";
import { checkVoiceDerivationCoverage, type VoiceDerivationCoverageResult } from "./voice/index.js";

const USAGE = `Usage: writer-check <record-file> [scan-dir] [options]
   or: writer-check voice-derivation-coverage <obligations-file> <brand-derived-rule-ids-file> [options]
   or: writer-check locale-coverage <registries-file> <source-locale> [declared-locale...] [options]

  record-file    Path to a CopyRecord JSON file (see @vespeneventures/writer's README). Required.
  scan-dir       Directory to scan for user-facing string/template literals. Defaults to the current working directory.

See also "writer-check addressability [scan-dir]" (this same file's other
subcommand, dispatched on argv[0] before anything below) — is user-facing
prose resolved from the copy registry by id, rather than typed inline? A
separate, stricter gate; not run as part of this default command.

Options:
  --help         Print this message and exit 0.

Exit codes: 0 = clean, 1 = at least one finding, 2 = could not run (bad input, missing/invalid record, nothing matched to scan, or every matched file failed to parse).

Run "writer-check voice-derivation-coverage --help" for the second subcommand's own usage.
Run "writer-check locale-coverage --help" for the third subcommand's own usage.
`;

const VOICE_DERIVATION_COVERAGE_USAGE = `Usage: writer-check voice-derivation-coverage <obligations-file> <brand-derived-rule-ids-file> [options]

  obligations-file             Path to a JSON file containing an array of voice rule id strings (the thing being checked FOR). Required.
  brand-derived-rule-ids-file  Path to a JSON file containing an array of voice rule id strings a brand attribute actually derives — e.g. every BrandDerivation.voiceRules entry a consumer's own strategy declares (the thing being checked). Required.

Options:
  --help               Print this message and exit 0.

Checks, in both directions, whether obligations-file fully accounts for the rule ids brand-derived-rule-ids-file lists — see checkVoiceDerivationCoverage's own doc comment (src/voice/derivation-coverage.ts) for why this package cannot derive that list itself and must take it from the caller.

Exit codes: 0 = satisfied, 1 = violated (a real coverage gap in either direction), 2 = indeterminate (could not run: bad input, missing/unreadable/unparseable file, zero obligations supplied, or zero brand-derived rule ids supplied).
`;

const LOCALE_COVERAGE_USAGE = `Usage: writer-check locale-coverage <registries-file> <source-locale> [declared-locale...] [options]

  registries-file   Path to a JSON file: a plain object mapping each locale to its CopyRegistry (unknown at parse time, validated per-locale by checkLocaleCoverage itself) — e.g. {"en": {...}, "fr": {...}}. Required.
  source-locale     The locale every other declared locale's coverage is measured against. Required.
  declared-locale    One or more locales (source-locale included) that make up the full set this run must cover. When omitted, defaults to every key registries-file itself declares, in file order. Pass this explicitly to additionally assert that some OTHER locale — declared, but with no registry present in registries-file at all — is missing; checkLocaleCoverage reports that as its own finding rather than silently ignoring it.

Options:
  --help         Print this message and exit 0.

Checks that every declared locale other than source-locale covers the same entry ids the source locale does, and reports missing coverage, orphaned entries, stale translations, and interpolation-parity gaps — see checkLocaleCoverage's own doc comment (src/locale-coverage.ts) for the full design.

Exit codes — the exact mapping LocaleCoverageReport.complete's own doc comment states as its caller contract: 0 = every declared locale was evaluated and no error-severity finding was produced, 1 = every declared locale was evaluated but at least one error-severity finding was produced, 2 = could not run (bad input, missing/unreadable/unparseable registries-file, registries-file is not a JSON object, zero declared locales, or at least one declared locale was NOT actually evaluated — an entirely-absent, invalid, or mis-keyed target registry, or the source locale itself missing/invalid/empty).
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
  brandDerivedRuleIdsFile?: string;
  help: boolean;
}

function parseVoiceDerivationCoverageArgs(argv: string[]): VoiceDerivationCoverageArgs {
  let obligationsFile: string | undefined;
  let brandDerivedRuleIdsFile: string | undefined;
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
    } else if (brandDerivedRuleIdsFile === undefined) {
      brandDerivedRuleIdsFile = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { obligationsFile, brandDerivedRuleIdsFile, help };
}

type JsonReadResult = { ok: true; value: unknown } | { ok: false; detail: string };

/**
 * Reads and JSON-parses a file, never throwing: an I/O failure or a JSON
 * syntax error is returned as `{ ok: false, detail }`, the same
 * never-throw discipline `readCopyRecord` (`registry.ts`) holds to for the
 * copy record it loads. Kept local to this file rather than promoted to a
 * shared helper: `./voice` is deliberately zero-I/O (see `checker.ts`'s own
 * doc comment, "Pure, no I/O"), so the one place in this package that reads
 * either of `checkVoiceDerivationCoverage`'s two lists off disk is this
 * CLI, not the `voice` module itself.
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

type StringListReadResult = { ok: true; value: string[] } | { ok: false; detail: string };

/** Both `obligations-file` and `brand-derived-rule-ids-file` must be a JSON array of non-empty strings — the plain rule-id list shape `checkVoiceDerivationCoverage` takes on both sides. Any other shape is "could not run", never a silently-empty list. `label` names which of the two files this call is validating, for the error message only. */
function readStringList(label: string, path: string): StringListReadResult {
  const parsed = readJsonFile(label, path);
  if (!parsed.ok) return parsed;
  const { value } = parsed;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) {
    return { ok: false, detail: `${label} "${path}" must be a JSON array of non-empty strings, got ${JSON.stringify(value)}.` };
  }
  return { ok: true, value };
}

function printVoiceDerivationCoverageReport(result: VoiceDerivationCoverageResult): void {
  console.log(
    `${result.obligationsChecked} obligation(s) checked against ${result.rulesChecked} brand-derived rule id(s).`,
  );
  if (result.obligationsMissingFromRecord.length > 0) {
    console.log(`${result.obligationsMissingFromRecord.length} obligation(s) name a rule id not in the supplied brand-derived list:`);
    for (const id of result.obligationsMissingFromRecord) console.log(`  ${id}`);
  }
  if (result.recordRulesNotObliged.length > 0) {
    console.log(`${result.recordRulesNotObliged.length} brand-derived rule id(s) are reached by no obligation:`);
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
 * A file that is missing/unreadable/unparseable never reaches
 * `checkVoiceDerivationCoverage` at all: it is "could not run" (exit `2`),
 * decided and reported here, before the pure check function is ever
 * called — exactly how `main()` above never calls `checkCopyTraceability`
 * when `readCopyRecord` fails. `checkVoiceDerivationCoverage` itself only
 * ever sees two real `string[]` lists; its own
 * `"no-obligations-provided"`/`"no-brand-derived-rules-provided"`
 * indeterminate reasons are for a run that loaded both files cleanly but
 * had nothing to compare (one or both lists parsed as `[]`).
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
  if (!args.brandDerivedRuleIdsFile) {
    throw new CliInputError("brand-derived-rule-ids-file is required");
  }

  const obligationsFile = resolve(args.obligationsFile);
  const brandDerivedRuleIdsFile = resolve(args.brandDerivedRuleIdsFile);
  requireFile("obligations-file", obligationsFile);
  requireFile("brand-derived-rule-ids-file", brandDerivedRuleIdsFile);

  console.log(`Obligations file: ${obligationsFile}`);
  console.log(`Brand-derived rule ids file: ${brandDerivedRuleIdsFile}`);

  const obligationsRead = readStringList("obligations-file", obligationsFile);
  if (!obligationsRead.ok) {
    console.error(`\nObligations could not be loaded: ${obligationsRead.detail}`);
    console.error("Refusing to report a pass with no trustworthy obligation list to check against.");
    return 2;
  }

  const brandDerivedRuleIdsRead = readStringList("brand-derived-rule-ids-file", brandDerivedRuleIdsFile);
  if (!brandDerivedRuleIdsRead.ok) {
    console.error(`\nBrand-derived rule ids could not be loaded: ${brandDerivedRuleIdsRead.detail}`);
    console.error("Refusing to report a pass with no trustworthy brand-derived rule id list to check against.");
    return 2;
  }

  const result = checkVoiceDerivationCoverage(obligationsRead.value, brandDerivedRuleIdsRead.value);
  printVoiceDerivationCoverageReport(result);

  // Same fail-closed mapping `main()` uses above, restated for this gate's
  // own three-state result: `indeterminate` (nothing meaningful was
  // compared) is `2`, never `0` and never conflated with a real `1`
  // violation.
  if (!result.ok && result.reason !== "coverage-gap") return 2;
  return result.ok ? 0 : 1;
}

// ---------------------------------------------------------------------
// locale-coverage — the third subcommand. See this file's top-of-file doc
// comment and `./locale-coverage.ts` for the full design; everything below
// is presentation only, the same split `main()` draws for
// `checkCopyTraceability` and `runVoiceDerivationCoverage` draws for
// `checkVoiceDerivationCoverage`.
// ---------------------------------------------------------------------

interface LocaleCoverageArgs {
  registriesFile?: string;
  sourceLocale?: string;
  declaredLocales: string[];
  help: boolean;
}

function parseLocaleCoverageArgs(argv: string[]): LocaleCoverageArgs {
  let registriesFile: string | undefined;
  let sourceLocale: string | undefined;
  const declaredLocales: string[] = [];
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    }
    if (registriesFile === undefined) {
      registriesFile = arg;
    } else if (sourceLocale === undefined) {
      sourceLocale = arg;
    } else {
      declaredLocales.push(arg);
    }
  }

  return { registriesFile, sourceLocale, declaredLocales, help };
}

type RegistriesReadResult = { ok: true; value: Record<string, unknown> } | { ok: false; detail: string };

/**
 * Reads and JSON-parses `registries-file`, then confirms the TOP-LEVEL shape
 * is a plain object (never an array, never `null`, never a primitive) —
 * `checkLocaleCoverage` itself validates each PER-LOCALE registry value via
 * `validateCopyRegistryShape`, so this only needs to confirm the container
 * this CLI reads off disk is the `Record<CopyLocale, unknown>` shape
 * `checkLocaleCoverage` expects, never the per-locale contents. Mirrors
 * `readJsonFile`'s never-throw discipline: any failure comes back as
 * `{ ok: false, detail }`, never an exception.
 */
function readRegistriesFile(path: string): RegistriesReadResult {
  const parsed = readJsonFile("registries-file", path);
  if (!parsed.ok) return parsed;
  const { value } = parsed;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      detail: `registries-file "${path}" must be a JSON object mapping each locale to its CopyRegistry, got ${JSON.stringify(value)}.`,
    };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

function printLocaleCoverageReport(result: LocaleCoverageReport): void {
  console.log(
    `Source locale "${result.sourceLocale}": ${result.sourceEntryCount} entr${result.sourceEntryCount === 1 ? "y" : "ies"}. ` +
      `${result.checkedLocales.length} of ${result.targetLocales.length} declared target locale(s) evaluated.`,
  );
  if (result.skippedLocales.length > 0) {
    console.error(`${result.skippedLocales.length} declared locale(s) could NOT be evaluated:`);
    for (const s of result.skippedLocales) console.error(`  ${s.locale}  [${s.reason}]`);
  }
  if (result.findings.length === 0) {
    console.log("No findings.");
    return;
  }
  console.log(`\n${result.findings.length} finding(s):`);
  for (const f of result.findings) {
    const where = f.locale ? (f.entryId ? `${f.locale}:${f.entryId}` : f.locale) : "(locale set)";
    console.log(`  [${f.severity}] [${f.rule}] ${where}  ${f.message}`);
  }
}

/**
 * `locale-coverage`'s own `main`-equivalent: parse argv, load the
 * registries file, run `checkLocaleCoverage`, print a report, pick an exit
 * code — the identical shape `runVoiceDerivationCoverage` above uses for
 * `checkVoiceDerivationCoverage`.
 *
 * `declared-locale` defaults to every key `registries-file` itself declares,
 * in file order, when none are given on argv — the common case, where a
 * project simply wants "check coverage across every locale I actually
 * produced a registry for." Passing `declared-locale` explicitly is how a
 * caller additionally asserts that some OTHER locale — one the project is
 * SUPPOSED to cover but has no registry file for at all — is missing;
 * `checkLocaleCoverage` reports that as its own `"target-locale-missing"`
 * finding (and folds the run to `complete: false`) rather than this CLI
 * silently narrowing the declared set to only what exists on disk.
 *
 * A registries-file that is missing/unreadable/unparseable/not-an-object
 * never reaches `checkLocaleCoverage` at all: it is "could not run" (exit
 * `2`), decided and reported here — exactly how `main()` above never calls
 * `checkCopyTraceability` when `readCopyRecord` fails, and
 * `runVoiceDerivationCoverage` never calls `checkVoiceDerivationCoverage`
 * when either of its own files fails to load.
 */
function runLocaleCoverage(argv: string[]): number {
  const args = parseLocaleCoverageArgs(argv);
  if (args.help) {
    console.log(LOCALE_COVERAGE_USAGE);
    return 0;
  }
  if (!args.registriesFile) {
    throw new CliInputError("registries-file is required");
  }
  if (!args.sourceLocale) {
    throw new CliInputError("source-locale is required");
  }

  const registriesFile = resolve(args.registriesFile);
  requireFile("registries-file", registriesFile);

  console.log(`Registries file: ${registriesFile}`);
  console.log(`Source locale: ${args.sourceLocale}`);

  const registriesRead = readRegistriesFile(registriesFile);
  if (!registriesRead.ok) {
    console.error(`\nRegistries could not be loaded: ${registriesRead.detail}`);
    console.error("Refusing to report a pass with no trustworthy registry set to check coverage against.");
    return 2;
  }

  const declaredLocales =
    args.declaredLocales.length > 0 ? args.declaredLocales : Object.keys(registriesRead.value);

  console.log(`Declared locales: ${declaredLocales.length > 0 ? declaredLocales.join(", ") : "(none)"}`);

  const result = checkLocaleCoverage(registriesRead.value, args.sourceLocale, declaredLocales);
  printLocaleCoverageReport(result);

  // The exact mapping LocaleCoverageReport.complete's own doc comment
  // states as its caller contract (locale-coverage.ts): `!complete` — not
  // every declared locale was actually evaluated, including "checked
  // nothing" shapes like zero declared locales or a missing/empty source
  // locale — is always `2`, never `0` and never conflated with a real `1`.
  // A `complete` run with only warning-severity findings (e.g. every
  // finding is `orphaned-entry`, `stale-entry`, or `provenance-missing`)
  // is `0`; at least one error-severity finding (missing-entry,
  // interpolation-missing/-extra, or a structural decline) is `1`.
  if (!result.complete) return 2;
  return result.findings.some((f) => f.severity === "error") ? 1 : 0;
}

/**
 * `copy-addressability`'s own accounting — a DIFFERENT gate from
 * traceability above (see `addressability.ts`'s top doc comment): is this
 * same source tree's user-facing prose resolved from the copy registry by
 * id, rather than typed inline? Mirrors `printScanAccounting`'s
 * "print every skip/exclusion count unconditionally" discipline.
 */
function printAddressabilityAccounting(scan: AddressabilityScanResult): void {
  console.log(
    `[addressability] Scanned ${scan.filesScanned} file${scan.filesScanned === 1 ? "" : "s"}, ` +
      `${scan.violations.length} inline user-facing string${scan.violations.length === 1 ? "" : "s"} found.`,
  );

  if (scan.skippedByDesign.length > 0) {
    console.log(`[addressability] ${scan.skippedByDesign.length} file(s) skipped by design (test/check/declaration files).`);
  }

  if (scan.excludedFiles.length > 0) {
    console.log(`[addressability] ${scan.excludedFiles.length} file(s) excluded via pathExclusions.`);
  }

  if (scan.pathExclusionFindings.length > 0) {
    for (const f of scan.pathExclusionFindings) {
      const line = `[addressability]   [${f.rule}] ${f.path ? `"${f.path}": ` : ""}${f.message}`;
      if (f.severity === "error") console.error(line);
      else console.log(line);
    }
  }

  if (scan.parseFailures.length > 0) {
    console.error(`[addressability] ${scan.parseFailures.length} file(s) could NOT be parsed and were NOT scanned:`);
    for (const p of scan.parseFailures) console.error(`  ${p.file}: ${p.detail}`);
  }

  if (scan.unchecked.length > 0) {
    console.error(`[addressability] ${scan.unchecked.length} string position(s) recognized but NOT reliably classified — coverage for these is incomplete:`);
    for (const u of scan.unchecked) console.error(`  [${u.kind}] ${u.file}:${u.line}  ${u.detail}`);
  }
}

function printAddressabilityReport(result: AddressabilityGateResult): void {
  if (result.violations.length === 0) {
    console.log("[addressability] No inline user-facing prose found.");
  } else {
    console.log(`\n[addressability] ${result.violations.length} violation(s):`);
    for (const v of result.violations) {
      const where = v.position === "markup-text" ? "a markup text node" : `the "${v.attribute}" attribute`;
      console.log(`  [copy-addressability] ${v.file}:${v.line}  inline prose in ${where}, not resolved from the copy registry by id: ${v.raw}`);
    }
  }
  if (result.verdict === "indeterminate") {
    console.error(`[addressability] indeterminate — ${result.reasons.join("; ")}. Refusing to report a pass.`);
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
  // Subcommand dispatch: only `argv[0] === "voice-derivation-coverage"` or
  // `argv[0] === "locale-coverage"` exactly diverts to the second/third
  // subcommand — see this file's top-of-file doc comment. Every other first
  // argument, including any real `record-file` path an existing caller
  // already passes, falls straight through to the original behavior below,
  // unchanged.
  if (argv[0] === "voice-derivation-coverage") {
    return runVoiceDerivationCoverage(argv.slice(1));
  }
  if (argv[0] === "locale-coverage") {
    return runLocaleCoverage(argv.slice(1));
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
      console.error(`writer-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`writer-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      process.exitCode = 2;
    }
  }
}

// ============================================================================
// "writer-check addressability" — a SUBCOMMAND of the SAME `writer-check` bin,
// same file, same three-state exit-code shape as the default command
// above. Dispatched on `argv[0] === "addressability"` at the very bottom
// of this file, BEFORE any of the default command's own argument parsing
// runs — see this file's top doc comment for why this is a subcommand
// rather than a second `bin` entry, and why its own exit code is not
// folded into the default command's.
// ============================================================================

const ADDRESSABILITY_USAGE = `Usage: writer-check addressability [scan-dir] [options]

  scan-dir       Directory to scan for user-facing prose. Defaults to the current working directory.

Checks whether user-facing prose is resolved from the copy registry by id,
rather than typed inline in a component — a stricter, separate question
from writer-check's default traceability command (see
@vespeneventures/writer's addressability.ts for the full contract). Three
positions are classified: markup text nodes and the four user-facing
attributes (aria-label, placeholder, alt, title) are violations when they
carry literal prose; every other string position (a template literal, an
object/array literal value, a prop outside the four) is reported as
unclassifiable rather than assumed clean. There is no citation or
registry-text-match escape hatch here, unlike the default command.

Options:
  --help         Print this message and exit 0.

Exit codes: 0 = clean, 1 = at least one inline user-facing string found, 2 = could not run (bad input, nothing matched to scan, every matched file failed to parse, or a string position could not be confidently classified).
`;

interface AddressabilityParsedArgs {
  scanDir?: string;
  help: boolean;
}

function parseAddressabilityArgs(argv: string[]): AddressabilityParsedArgs {
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
    if (scanDir === undefined) {
      scanDir = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { scanDir, help };
}

/**
 * Exported (unlike a typical CLI `main`) for the identical reason `main`
 * above is — `cli.test.ts` exercises the whole argv-to-exit-code contract
 * directly against real `mkdtemp` directories, without spawning a
 * subprocess.
 */
export function mainAddressabilityCheck(argv: string[]): number {
  const args = parseAddressabilityArgs(argv);
  if (args.help) {
    console.log(ADDRESSABILITY_USAGE);
    return 0;
  }

  const scanDir = resolve(args.scanDir ?? process.cwd());
  requireDirectory("scan-dir", scanDir);

  console.log(`Scan directory: ${scanDir}`);

  // Throws (fail-closed) on an unreadable directory, exactly like
  // `scanCopySourceTree` — caught by `runAddressabilityCheck()`'s own
  // catch-all below.
  const scan = scanAddressabilitySources(scanDir);
  printAddressabilityAccounting(scan);

  const result = checkAddressability(scan);
  printAddressabilityReport(result);

  // Mirrors writer-check's own "unchecked/could-not-run wins over a real
  // finding" precedence (see this file's top doc comment) —
  // `checkAddressability` already applies it when computing `verdict`, so
  // this is just the verdict-to-exit-code mapping.
  if (result.verdict === "indeterminate") return 2;
  return result.verdict === "violated" ? 1 : 0;
}

/**
 * `argv` here is whatever followed the `"addressability"` subcommand token
 * — the dispatch at the bottom of this file strips that token BEFORE
 * calling this, so `mainAddressabilityCheck` never sees it and its own
 * argument parsing (`parseAddressabilityArgs`) stays identical to
 * `main`'s own shape (just `[scan-dir] [options]`, no subcommand of its
 * own to account for).
 */
function runAddressabilityCheck(argv: string[]): void {
  try {
    process.exitCode = mainAddressabilityCheck(argv);
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`writer-check addressability: ${error.message}`);
      console.error(`\n${ADDRESSABILITY_USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(
        `writer-check addressability: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
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

/**
 * `writer-check` and `writer-check addressability` are ONE `bin` entry, one
 * compiled file, dispatched by an explicit FIRST ARGUMENT — never by how
 * this file was invoked (its own path, a symlink name, an installed `bin`
 * shim, ...). That is deliberate: this repository's own root
 * `package.json` invokes every gate by compiled path
 * (`node packages/ui/dist/tokens/contrast-cli.js`,
 * `node packages/controller/dist/cli.js`, ...), never by `bin` name, so
 * any dispatch keyed on the invoking path/name (a second `bin` entry
 * pointing at this same file, or a `basename(process.argv[1])` sniff)
 * would be unreachable under that invocation style — worse, it would
 * silently fall through to the DEFAULT command instead of erroring,
 * exactly the "runs the wrong thing without ever failing" failure mode a
 * gate must never have. `rawArgs[0]` is read BEFORE `main()`'s own
 * `parseArgs` ever sees the array, so the default command's argument
 * shape is completely unaffected by this subcommand existing at all.
 */
if (detectMainModule()) {
  const rawArgs = process.argv.slice(2);
  if (rawArgs[0] === "addressability") {
    runAddressabilityCheck(rawArgs.slice(1));
  } else {
    run();
  }
}
