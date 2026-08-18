/**
 * Wires the acquisition mechanism above (`./gitleaks.ts`) to the judge this
 * package ships at its own root (`checkSecretScan`, in `../secret-scan.ts`),
 * by producing the one artifact that connects them: a `SecretScanObservation`
 * built from gitleaks' own report, rather than hand-assembled by a caller's
 * collector script.
 *
 * THIS IS THE #283 WIRING
 * -------------------------
 * `verify-standards` and `secret-scan` shipped as two packages, and the
 * standards gate could only ever ask a caller's own script to state whether
 * a scan was attempted — it had no mechanism of its own to attempt one. This
 * module is what closes that: given a resolved gitleaks binary, it can run
 * it and hand `checkSecretScan` a real observation.
 *
 * THE SPLIT THIS PRESERVES
 * -------------------------
 * `checkSecretScan` evaluates a record of an attempt; it does not care who
 * produced that record or how (see its own header). Nothing here changes
 * that. `attemptGitleaksScan` is one more way to produce an observation, not
 * a replacement for the observation contract — a caller scanning with a
 * different tool, or collecting from a step this package never heard of,
 * still builds a `SecretScanObservation` by hand and still gets a real
 * verdict from `checkSecretScan`. This module exists so a caller who *does*
 * want to run gitleaks does not have to reinvent the translation from its
 * report shape into this package's contract — the attested path keeps
 * working, unmodified, for everyone else.
 *
 * WHY EXECUTION IS INJECTED
 * ---------------------------
 * Spawning a process is exactly the kind of I/O this package's tests are
 * forbidden from doing for real (see the vitest config header and #283's
 * hermetic-tests requirement — the same rule the binary download already
 * follows). `GitleaksExecutor` is the same shape of seam `CliPort` uses for
 * the CLI: `attemptGitleaksScan` is a pure function of whatever the executor
 * returns, so a test can inject a canned result and this module is
 * exercised completely without a real gitleaks binary on the test runner's
 * PATH — and without a real repository for it to scan.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SecretScanHit, SecretScanObservation, SecretScanScope } from "../secret-scan.js";

/** What one run of the gitleaks binary produced. */
export interface GitleaksRunResult {
  /** The process's own exit code. */
  readonly exitCode: number;
  /**
   * gitleaks' own report, already parsed from whatever format the caller's
   * invocation asked for (JSON is the only format this module reads).
   * `undefined` when the process produced none — it crashed before writing
   * one, or was asked not to.
   */
  readonly report: unknown;
}

/**
 * Runs the verified gitleaks binary and returns its outcome. Injected so no
 * test spawns a real process — see this module's own header.
 */
export type GitleaksExecutor = (binaryPath: string, args: readonly string[]) => GitleaksRunResult;

export interface AttemptGitleaksScanOptions {
  /** The verified binary's path, from `downloadAndVerifyGitleaks` or `getCachedGitleaksPath`. */
  readonly binaryPath: string;
  /** The version this binary reports itself as. Carried straight into the observation. */
  readonly toolVersion: string;
  /** What this run covers. Caller-declared, exactly as `checkSecretScan` requires — never inferred here. */
  readonly scope: SecretScanScope;
  /**
   * How many commits (or, for `working-tree`, files) this run actually
   * examined. gitleaks' own report does not answer this for every scope, so
   * this stays a caller-declared fact rather than one this module guesses.
   */
  readonly unitsScanned: number;
  /** The arguments to invoke the binary with. This module adds none of its own beyond report options — see `defaultGitleaksExecutor`. */
  readonly args: readonly string[];
  readonly execute: GitleaksExecutor;
}

/** One gitleaks JSON report entry, read minimally: only what a `SecretScanHit` needs survives. */
interface GitleaksReportEntry {
  readonly RuleID?: unknown;
  readonly File?: unknown;
  readonly Commit?: unknown;
}

function isReportEntry(value: unknown): value is GitleaksReportEntry {
  return typeof value === "object" && value !== null;
}

function toHit(entry: GitleaksReportEntry): SecretScanHit {
  return {
    ruleId: typeof entry.RuleID === "string" && entry.RuleID !== "" ? entry.RuleID : "unnamed-rule",
    path: typeof entry.File === "string" && entry.File !== "" ? entry.File : "<unreported path>",
    ...(typeof entry.Commit === "string" && entry.Commit !== "" ? { commit: entry.Commit } : {}),
  };
}

/**
 * Runs gitleaks through the injected executor and returns the observation
 * `checkSecretScan` evaluates.
 *
 * `attempted` is always `true` in what this returns: by the time this
 * function is called at all, the caller has already resolved a binary and is
 * asking to run it. A caller whose own step never reached this far — the
 * binary could not be resolved, the process could not be spawned at all —
 * states `attempted: false` itself, in a `SecretScanObservation` it builds
 * without this function; that failure has no gitleaks report for this
 * function to translate, and inventing one here would misreport a tool
 * outage as a tool run — precisely the failure `checkSecretScan`'s own
 * header describes.
 *
 * A report entry this module cannot read (not an object) is skipped rather
 * than thrown on, for the same reason every check elsewhere in this package
 * turns a data problem into a verdict rather than an exception: this
 * function's caller is a CI process, and an uncaught throw here would end it
 * on Node's exit status `1` — which in this package's contract means
 * "violated" — with no report and no named reason.
 */
export function attemptGitleaksScan(options: AttemptGitleaksScanOptions): SecretScanObservation {
  const { exitCode, report } = options.execute(options.binaryPath, options.args);
  const hits: readonly SecretScanHit[] = Array.isArray(report) ? report.filter(isReportEntry).map(toHit) : [];
  return {
    attempted: true,
    toolName: "gitleaks",
    toolVersion: options.toolVersion,
    exitCode,
    scope: options.scope,
    unitsScanned: options.unitsScanned,
    hits,
  };
}

/**
 * A real `GitleaksExecutor`, for a caller's own collection step to use
 * directly instead of writing one. Not used by this package's own tests —
 * see this module's header — and not required: a caller may supply any
 * executor shaped like `GitleaksExecutor` instead, including one this
 * package never heard of.
 *
 * gitleaks writes its JSON report to a file rather than stdout, so this
 * executor asks for one in a scratch directory it owns, reads it back, and
 * removes the directory whether or not the process succeeded. `--report-format
 * json` and `--report-path` are appended after whatever arguments the caller
 * supplied, so this executor's copy of those two flags always wins over any
 * the caller passed — deterministic, rather than silently reading whichever
 * file the last flag on the command line happened to name.
 */
export const defaultGitleaksExecutor: GitleaksExecutor = (binaryPath, args) => {
  const scratchDir = mkdtempSync(join(tmpdir(), "vespeneventures-gitleaks-report-"));
  const reportPath = join(scratchDir, "report.json");
  try {
    const result = spawnSync(binaryPath, [...args, "--report-format", "json", "--report-path", reportPath], {
      encoding: "utf8",
    });
    let report: unknown;
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8"));
    } catch {
      // No report, or an unparseable one — the common case is a process that
      // crashed before writing anything. `attemptGitleaksScan` treats a
      // non-array report as zero hits; the exit code is what actually
      // carries a crash forward, and `checkSecretScan` rejects an exit code
      // it does not recognise as clean or as findings.
      report = undefined;
    }
    return { exitCode: result.status ?? 1, report };
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
};
