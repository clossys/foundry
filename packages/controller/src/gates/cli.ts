#!/usr/bin/env node
/**
 * `foundry-check` — the CLI for `runFoundationCheck`, the one function this
 * whole foundation exists so a consumer can call without writing their own
 * script to use it. This file is presentation only: parse argv, call
 * `runFoundationCheck`, print a report, pick an exit code. All the actual
 * work happens in `./foundation.js` (and everything it delegates to) — this
 * package does zero I/O of its own beyond what `runFoundationCheck` already
 * does.
 *
 * Exit codes — this is a contract a consumer's CI depends on. They are no
 * longer picked by hand here: `main` builds a `GateResult` (see
 * `./result.ts`) and hands it to `gateResultToExitCode`, so the exit code
 * is a projection of the verdict rather than a second, parallel encoding
 * of it that can drift from the first.
 *
 *   0 — `satisfied`: a COMPLETE tree was catalogued, at least one package
 *       was actually evaluated, and no error-severity finding came back.
 *       Warnings alone never produce anything but 0.
 *   1 — `violated`: evaluated cleanly, at least one error-severity finding.
 *   2 — `indeterminate`: could not evaluate. Bad input (an unknown flag, a
 *       `--max-depth` that isn't a positive integer, a root that doesn't
 *       exist or isn't a readable directory), an unexpected exception, OR —
 *       new, and the reason this file was retrofitted — a run whose
 *       coverage was incomplete or whose catalogue was empty.
 *
 * THE DEFECT THIS RETROFIT FIXES. `main` used to end with
 * `errors > 0 ? 1 : 0`, computed from findings alone. `report.complete`
 * was printed — in a deliberately loud `!!! COVERAGE INCOMPLETE ... this
 * report does NOT verify a clean tree !!!` banner — and then ignored when
 * picking the exit code. Two consequences, both of them the exact shape
 * this repository's gate-result ternary exists to make impossible:
 *
 *   - Every `unusable` skip (`packages-dir-missing`,
 *     `unparseable-manifest`, `manifest-not-object`,
 *     `manifest-missing-name-or-version`) is warning-severity, so a run
 *     that could not read part of the tree printed the banner and then
 *     exited `0`. A CI job reading the exit code — which is the only
 *     thing a CI job reads — saw a pass.
 *   - A root whose packages directory exists but holds no packages
 *     catalogued zero entries, evaluated nothing, and exited `0`: a
 *     vacuous pass with no evidence behind it.
 *
 * Both now fold to `indeterminate` and exit `2`. `unreadable` skips, which
 * are error-severity and therefore used to exit `1`, now also exit `2`:
 * they are "could not evaluate", not "evaluated and found a violation",
 * and `2` is where this repository puts that. Nothing that failed before
 * passes now — every reclassification is toward the stricter code.
 *
 * Never throws an unhandled exception: `main` itself catches every risky
 * call it makes — argument parsing and the foundation check itself — and
 * turns anything unexpected into exit code 2 directly (issue #392). It used
 * to rely on a separate `run()` wrapper's `catch` for this, which meant
 * `main` was not actually safe to call on its own, unlike every other
 * exported `main` in this fleet.
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogFinding } from "../catalog/index.js";
import { runFoundationCheck } from "./foundation.js";
import { createGateReasons, gateResultToExitCode, gateSatisfied, gateViolated, type GateResult } from "./result.js";
import type { FoundationReport } from "./types.js";

const USAGE = `Usage: foundry-check [root] [options]

  root                   Directory to check. Defaults to the current working directory.

Options:
  --scope <scope>        Passed through to evaluateCatalog. Restricts which of a package's real dependencies/peerDependencies count as internal to this catalog, for the internal-dep-missing and dependency-cycle rules.
  --packages-dir <dir>   Directory holding packages, relative to root. Must NOT be absolute — an absolute path is rejected (exit 2) rather than silently escaping root. Defaults to "packages".
  --max-depth <n>        How many directory levels below packages-dir to search. Must be a positive integer. Defaults to 4.
  --help                 Print this message and exit 0.

Exit codes: 0 = clean (a complete tree, at least one package evaluated, no error-severity finding), 1 = at least one error-severity finding, 2 = could not evaluate (bad input, unexpected failure, incomplete coverage, or no packages catalogued).
`;

/**
 * Every reason `foundry-check` can ever report as `indeterminate`, declared
 * in one place. Declaring the vocabulary is the half of the contract that
 * keeps "could not evaluate" from quietly widening: a new failure mode has
 * to be added to this array — and therefore reviewed as a new failure mode
 * — before any call site can emit it. See `createGateReasons`.
 */
export const FOUNDRY_CHECK_REASONS = createGateReasons(["incomplete-coverage", "no-packages-catalogued"] as const);

/** The declared indeterminate vocabulary of `foundry-check`, as a type. */
export type FoundryCheckIndeterminateReason = (typeof FOUNDRY_CHECK_REASONS.reasons)[number];

interface ParsedArgs {
  root: string;
  scope?: string;
  packagesDir?: string;
  maxDepth?: number;
  help: boolean;
}

/** Thrown for anything wrong with the arguments themselves — always maps to exit code 2, never 1. */
class CliInputError extends Error {}

function parseArgs(argv: string[]): ParsedArgs {
  let root: string | undefined;
  let scope: string | undefined;
  let packagesDir: string | undefined;
  let maxDepth: number | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--scope": {
        const value = argv[++i];
        if (value === undefined) throw new CliInputError("--scope requires a value");
        scope = value;
        break;
      }
      case "--packages-dir": {
        const value = argv[++i];
        if (value === undefined) throw new CliInputError("--packages-dir requires a value");
        // The help text promises "relative to root". Nothing downstream
        // enforced that: `path.resolve(root, packagesDir)` silently
        // discards `root` when `packagesDir` is itself absolute, so a
        // caller who passes an absolute path gets a report about a
        // completely different tree, with `root` ignored and nothing in
        // the output revealing it. Rejecting it here, loudly, at parse
        // time keeps the promise and the behaviour in agreement.
        if (isAbsolute(value)) {
          throw new CliInputError(`--packages-dir must be relative to root, got an absolute path "${value}"`);
        }
        packagesDir = value;
        break;
      }
      case "--max-depth": {
        const value = argv[++i];
        if (value === undefined) throw new CliInputError("--max-depth requires a value");
        // Deliberately strict: only digits, no leading "+"/"-", no decimal
        // point, so "0", "-1", "2.5", and "abc" are all rejected the same
        // way buildCatalog's own maxDepth validation rejects them, except
        // here it is a hard CLI error (exit 2) rather than a silent
        // fallback to the default — bad input to a CLI should be loud.
        //
        // The regex alone is not enough: a numeral long enough (~309+
        // digits) still matches `^\d+$` but overflows `Number()` to
        // `Infinity`, which passes a bare `> 0` check and then fails
        // `Number.isInteger` further downstream in buildCatalog, silently
        // falling back to the default depth (4) with no signal at all.
        // `Number.isSafeInteger` rejects `Infinity` (and anything else
        // that overflowed or lost precision) explicitly, right here, with
        // the same loud error as any other malformed value.
        if (!/^\d+$/.test(value)) {
          throw new CliInputError(`--max-depth must be a positive integer, got "${value}"`);
        }
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) {
          throw new CliInputError(`--max-depth must be a positive integer, got "${value}"`);
        }
        maxDepth = parsed;
        break;
      }
      default:
        if (arg.startsWith("-")) {
          throw new CliInputError(`unknown flag "${arg}"`);
        }
        if (root !== undefined) {
          throw new CliInputError(`unexpected extra argument "${arg}" — foundry-check accepts at most one root`);
        }
        root = arg;
    }
  }

  return { root: root ?? process.cwd(), scope, packagesDir, maxDepth, help };
}

/**
 * Counts findings by severity. `CatalogFinding.severity` is a closed union
 * (`"error" | "warning"`) today, so this exhaustively switches over it
 * rather than treating "error" as the only case worth naming and folding
 * everything else into "warning" by default. That used to be exactly the
 * bug: a silent `else` branch means a THIRD severity value, if one is ever
 * added, gets counted as a warning with zero indication anything changed —
 * a `check`-style gate would keep exiting 0 for a severity it was never
 * told how to treat. The `never` assignment in `default` makes an
 * unhandled case a compile error the moment `CatalogFinding["severity"]`
 * grows a new member; the `throw` alongside it is the same guarantee at
 * runtime, for any value that reaches here without going through
 * TypeScript's own checking (e.g. `CatalogFinding[]` built by a caller
 * from parsed JSON). Exported so it can be exercised directly by a test
 * with a deliberately malformed finding, without spawning a subprocess.
 */
export function severityCounts(findings: CatalogFinding[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const finding of findings) {
    switch (finding.severity) {
      case "error":
        errors++;
        break;
      case "warning":
        warnings++;
        break;
      default: {
        const unhandled: never = finding.severity;
        throw new Error(`severityCounts: unknown finding severity ${JSON.stringify(unhandled)}`);
      }
    }
  }
  return { errors, warnings };
}

function formatFinding(finding: CatalogFinding): string {
  const location = finding.path !== undefined ? ` (${finding.path})` : "";
  return `  [${finding.severity}] ${finding.rule}${location}: ${finding.message}`;
}

/**
 * Prints the full report: coverage first, findings second. Coverage —
 * how many packages were catalogued AND how many paths were skipped — is
 * not optional trivia folded into a findings count. `catalog.skipped` is
 * the whole point of Part A: a user must never be able to mistake
 * "scanned everything, all clean" for "scanned some things, couldn't read
 * the rest", and the only way to guarantee that is to always say the
 * coverage numbers, unconditionally, and make it impossible to miss when
 * they're not what a "clean" run would look like.
 */
function printReport(report: FoundationReport): void {
  const packageCount = report.catalog.entries.length;
  const skipped = report.catalog.skipped ?? [];

  console.log(
    `Checked ${packageCount} package${packageCount === 1 ? "" : "s"}. ` +
      `${skipped.length} path${skipped.length === 1 ? "" : "s"} skipped.`,
  );

  if (!report.complete) {
    // Deliberately loud and impossible to miss: this is the difference
    // between a verified-clean result and an unreliable one. Every skipped
    // path is ALSO reported below as its own "skipped:*" finding (that's
    // evaluateCatalog's job) — this banner exists so the fact of incomplete
    // coverage doesn't require a reader to notice and count those findings
    // themselves.
    console.log(
      `\n!!! COVERAGE INCOMPLETE: ${skipped.length} path${skipped.length === 1 ? "" : "s"} could not be checked ` +
        `— this report does NOT verify a clean tree. See the skipped:* finding${skipped.length === 1 ? "" : "s"} ` +
        `below for exactly what and why. !!!`,
    );
  }

  const findings = report.findings;
  if (findings.length === 0) {
    console.log("No findings.");
  } else {
    const byPackage = new Map<string, CatalogFinding[]>();
    const unattributed: CatalogFinding[] = [];
    for (const finding of findings) {
      if (finding.package === undefined) {
        unattributed.push(finding);
        continue;
      }
      const list = byPackage.get(finding.package);
      if (list) list.push(finding);
      else byPackage.set(finding.package, [finding]);
    }

    for (const packageName of [...byPackage.keys()].sort()) {
      console.log(`\n${packageName}`);
      for (const finding of byPackage.get(packageName) as CatalogFinding[]) {
        console.log(formatFinding(finding));
      }
    }

    if (unattributed.length > 0) {
      console.log(`\n(not attributed to a single package)`);
      for (const finding of unattributed) {
        console.log(formatFinding(finding));
      }
    }
  }

  const { errors, warnings } = severityCounts(findings);
  console.log(
    `\n${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}` +
      ` across ${findings.length} finding${findings.length === 1 ? "" : "s"}.`,
  );
}

/**
 * Folds a `FoundationReport` into this repository's shared gate-result
 * ternary. This is the whole retrofit: the decision that used to live as
 * `errors > 0 ? 1 : 0` at the bottom of `main`, expressed once, in the
 * shared vocabulary, where it can be unit-tested without a subprocess.
 *
 * Precedence is `indeterminate` before `violated` before `satisfied`, the
 * same fail-closed ordering `foldGateResults` uses: a report whose coverage
 * is incomplete cannot vouch for its own findings either way, so it is
 * reported as unevaluated even when it also carries real error-severity
 * findings. Those findings are still printed in full by `printReport` —
 * this only decides what the run as a whole is allowed to claim.
 *
 * `gateSatisfied(entries.length)` is what makes the empty-catalogue case
 * impossible to get wrong: it refuses a passing result carrying zero
 * evaluated inputs, so "clean because nothing was looked at" throws at the
 * call site instead of returning `0`. The explicit check below turns that
 * into a named, machine-readable `indeterminate` reason first, so a caller
 * gets a reason rather than an exception.
 *
 * Exported for direct testing.
 */
export function foundationGateResult(report: FoundationReport): GateResult<CatalogFinding, FoundryCheckIndeterminateReason> {
  const skipped = report.catalog.skipped ?? [];

  if (!report.complete) {
    const reasons = skipped.map((skip) => `${skip.path} (${skip.reason})`).join(", ");
    return FOUNDRY_CHECK_REASONS.indeterminate(
      "incomplete-coverage",
      `${skipped.length} path${skipped.length === 1 ? "" : "s"} could not be checked: ${reasons}`,
    );
  }

  if (report.catalog.entries.length === 0) {
    return FOUNDRY_CHECK_REASONS.indeterminate(
      "no-packages-catalogued",
      "the tree was read completely and contained no packages — nothing was evaluated, so there is nothing to report clean",
    );
  }

  const errors = report.findings.filter((finding) => finding.severity === "error");
  if (errors.length > 0) {
    return gateViolated(errors);
  }

  return gateSatisfied(report.catalog.entries.length);
}

/**
 * Self-contained: never lets an exception escape, always returning
 * `0 | 1 | 2` itself — matching `inspector`'s and `builder`'s own CLI
 * `main` functions (issue #392). It used to let `parseArgs`'s
 * `CliInputError` propagate out to a separate `run()` wrapper's `catch`,
 * which meant `main` itself was not safe to call directly — every other
 * exported `main` in this fleet is. (This file's own header, above, already
 * documented the never-throws INTENT; this closes the gap between that
 * intent and where the catch actually lived.)
 */
export function main(): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`foundry-check: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`\n${USAGE}`);
    return 2;
  }

  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const root = resolve(args.root);
  if (!existsSync(root)) {
    console.error(`foundry-check: root "${root}" does not exist`);
    return 2;
  }
  let rootStat;
  try {
    rootStat = statSync(root);
  } catch (error) {
    console.error(`foundry-check: cannot read root "${root}": ${(error as Error).message}`);
    return 2;
  }
  if (!rootStat.isDirectory()) {
    console.error(`foundry-check: root "${root}" is not a directory`);
    return 2;
  }

  // Part A2: state what is actually about to be scanned — the resolved
  // root AND the resolved packages directory — before running the check.
  // This is what makes a `--packages-dir` mistake (or, before B2's fix, an
  // absolute one silently escaping `root` altogether) visible in the
  // output rather than only inferable from which packages happened to show
  // up in the report.
  const packagesDirName = args.packagesDir ?? "packages";
  const packagesDirAbs = resolve(root, packagesDirName);
  console.log(`Scanning root: ${root}`);
  console.log(`Packages directory: ${packagesDirAbs}`);

  // A backstop, not an expected path: `runFoundationCheck` is documented
  // never to throw (see this file's own header), the same way `inspector`'s
  // `main` wraps its own core call anyway — an exception escaping here
  // would otherwise end the process on status `1`, this contract's code for
  // "ran, and found a real violation", silently misreporting "could not
  // run" as "ran and failed."
  let report: FoundationReport;
  try {
    report = runFoundationCheck(root, {
      scope: args.scope,
      packagesDir: args.packagesDir,
      maxDepth: args.maxDepth,
    });
  } catch (error) {
    console.error(
      `foundry-check: the run did not complete, so nothing about this tree has been established: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }

  printReport(report);

  const result = foundationGateResult(report);
  if (result.verdict === "indeterminate") {
    // Printed to stderr, and phrased as a refusal rather than a finding:
    // this is the run declining to make a claim at all, which is a
    // different thing from the run making a claim a reader might disagree
    // with. Every finding above stays exactly as printed — nothing real is
    // hidden, the run just may not read as clean.
    console.error(`\nfoundry-check: could not evaluate (${result.reason}): ${result.detail ?? ""}`);
    console.error("Refusing to report a pass for a check that did not evaluate a complete tree.");
  }
  return gateResultToExitCode(result);
}

/** The installed entry point. `main` never throws, so there is nothing left for this to catch. */
export function run(): void {
  process.exitCode = main();
}

/**
 * Only run when this file is the script node was actually invoked with
 * (`node dist/cli.js ...`) — not when some other module (e.g. a test)
 * imports a named export like `severityCounts` from it. Without this guard
 * every import of this file would re-run the whole CLI, parsing whatever
 * `process.argv` the IMPORTER happens to have, as a side effect of the
 * import itself.
 *
 * Both sides MUST be real-path'd before comparing. `import.meta.url` is
 * always already a realpath, but `process.argv[1]` is the path exactly as
 * node was invoked with it, and `path.resolve` only normalises a path — it
 * does not follow symlinks. Any symlink anywhere in the invocation path
 * therefore made these two disagree.
 *
 * That is not an edge case: `npm install` publishes a `bin` as a SYMLINK at
 * `node_modules/.bin/foundry-check` pointing at this file, so every
 * consumer invoking the CLI the only way it ships — `foundry-check`, or
 * `npm exec foundry-check`, or a package.json script — hit the mismatch.
 * The failure mode was the worst possible one for a gate: `run()` never
 * fired, nothing was printed, and the process exited 0. A consumer's CI
 * would have gone green having validated precisely nothing. (macOS makes
 * this doubly likely, since `/tmp` is itself a symlink to `/private/tmp`.)
 *
 * `realpathSync` throws if a path does not exist. That should be
 * impossible for a module currently executing, but a throw here would
 * crash before the try/catch inside `run()` is ever reached, so it is
 * guarded: on failure, fall back to the plain normalised comparison rather
 * than take the process down.
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

const isMainModule = detectMainModule();
if (isMainModule) {
  run();
}
