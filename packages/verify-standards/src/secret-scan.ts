/**
 * The secret-scan check.
 *
 * This module does not scan anything. It evaluates a caller-supplied record
 * of a scan *attempt* — which tool ran, whether it ran at all, what it
 * exited with, how much it actually covered, and what it reported — and
 * decides whether that record is evidence of a clean repository, evidence of
 * a leak, or not evidence of anything.
 *
 * That split is the entire point, and it is not a stylistic preference. The
 * failure that motivated this package was a scan gate that stopped scanning
 * and kept reporting green: the third-party wrapper it invoked began erroring
 * out before any scan could start, for a reason external to the repository
 * (an account-level licensing condition), and every hand-maintained copy of
 * that gate treated "the step did not produce findings" as "there are no
 * findings." A checker that owns both the invocation and the interpretation
 * has no way to tell those apart, because by the time it is deciding, the
 * evidence of *how* it got no findings is gone. Splitting them means the
 * caller's workflow must state, as data, whether the scanner ran — and a
 * caller that cannot state it gets `indeterminate`, which fails closed.
 *
 * It also keeps this package free of the thing #257's scope discipline
 * forbids it to carry: no binary download, no checksum policy, no tool
 * version pin, no account values, no credential. The consuming workflow
 * acquires and runs its scanner however it likes — a distinct concern, with
 * its own package — and hands the outcome here.
 *
 * Zero I/O. Pure function of already-collected observations.
 */

import { createGateReasons, gateSatisfied, gateViolated } from "@vespeneventures/governance/gates";
import type { GateResult } from "@vespeneventures/governance/gates";
import type { CheckFinding } from "./types.js";

/** What part of the repository a scan attempt covered. Caller-declared; never inferred here. */
export type SecretScanScope = "full-history" | "commit-range" | "working-tree";

/** One credential-shaped hit the scanner reported. Deliberately value-free — never the matched secret itself. */
export interface SecretScanHit {
  /** The scanner's own rule identifier, verbatim. Opaque here. */
  readonly ruleId: string;
  /** Where it was found, as the scanner described it. */
  readonly path: string;
  /** Which commit it was found in, when the scanner reported one. */
  readonly commit?: string;
  /**
   * A description of the hit. It must never contain the matched value: this
   * package's own repository is public, and a finding rendered into a CI log
   * is as public as anything committed. Nothing here can enforce that about
   * a caller's data, which is exactly why it is stated.
   */
  readonly description?: string;
}

/**
 * A caller's record of one scan attempt.
 *
 * `attempted` is separate from every other field on purpose. A workflow step
 * that never executed, or that exploded before invoking its tool, has no
 * exit code and no findings — the same shape a caller might produce for a
 * clean scan if the distinction were left implicit.
 */
export interface SecretScanObservation {
  /** Whether the scanner was actually invoked. `false` is a real, reportable state, not an error. */
  readonly attempted: boolean;
  /** Which scanner ran. Opaque; this package endorses no tool. */
  readonly toolName?: string;
  /** The version the tool reported about itself. A tool that cannot say is not trusted to have scanned. */
  readonly toolVersion?: string;
  /** The scanner's process exit code, when it produced one. */
  readonly exitCode?: number;
  /** What the attempt covered. */
  readonly scope?: SecretScanScope;
  /**
   * How many commits (or, for `working-tree`, how many files) were actually
   * examined. Required to be positive for a `satisfied` verdict: a scan that
   * covered nothing is an unanswered question, not a clean result.
   */
  readonly unitsScanned?: number;
  /** Everything the scanner reported. */
  readonly hits: readonly SecretScanHit[];
}

/**
 * Which exit codes mean "ran to completion". A scanner in this class
 * conventionally exits `0` for a clean run and `1` for a run that completed
 * and found something; anything else is a tool failure, not a verdict.
 * Caller-overridable because that convention is a convention, not a law.
 */
export interface SecretScanPolicy {
  /** Exit code meaning "completed, nothing found". Defaults to `0`. */
  readonly cleanExitCode?: number;
  /** Exit code meaning "completed, findings reported". Defaults to `1`. */
  readonly findingsExitCode?: number;
}

/** Every reason this check can decline to answer. */
export const secretScanReasons = createGateReasons([
  "no-observation-supplied",
  "scan-not-attempted",
  "tool-unidentified",
  "tool-outcome-unknown",
  "tool-errored",
  "scope-undeclared",
  "empty-scan-scope",
  "inconsistent-report",
] as const);

export type SecretScanReason = (typeof secretScanReasons.reasons)[number];

/** One reportable problem: a credential-shaped string that reached the repository. */
export interface SecretScanFinding extends CheckFinding {
  readonly rule: "secret-detected";
}

/**
 * Evaluates one scan attempt.
 *
 * Ordering matters and is deliberate: every "could this record be trusted at
 * all" question is asked and answered before the hit list is so much as
 * counted. A record that cannot be trusted must not be able to reach the
 * branch that reports a clean pass, and the only structural guarantee of
 * that is to make the clean branch the last one in the function.
 */
export function checkSecretScan(
  observation: SecretScanObservation | undefined,
  policy: SecretScanPolicy = {},
): GateResult<SecretScanFinding, SecretScanReason> {
  if (observation === undefined) {
    return secretScanReasons.indeterminate(
      "no-observation-supplied",
      "No secret-scan observation was supplied. Absence of a record is not a clean record.",
    );
  }
  if (observation.attempted !== true) {
    return secretScanReasons.indeterminate(
      "scan-not-attempted",
      "The scanner was not invoked for this run. A gate that quietly stops running under some trigger condition, " +
        "while continuing to report a pass, is the exact defect this check exists to refuse.",
    );
  }
  if (typeof observation.toolName !== "string" || observation.toolName.trim() === "") {
    return secretScanReasons.indeterminate("tool-unidentified", "The scan record does not name the tool that ran.");
  }
  if (typeof observation.toolVersion !== "string" || observation.toolVersion.trim() === "") {
    return secretScanReasons.indeterminate(
      "tool-unidentified",
      `${observation.toolName} did not report a version. A binary that cannot identify itself cannot be held to a ` +
        "known behaviour, so its silence is not evidence.",
    );
  }
  if (typeof observation.exitCode !== "number" || !Number.isSafeInteger(observation.exitCode)) {
    return secretScanReasons.indeterminate(
      "tool-outcome-unknown",
      `${observation.toolName} produced no usable exit status, so whether it completed is unknown.`,
    );
  }

  const cleanExitCode = policy.cleanExitCode ?? 0;
  const findingsExitCode = policy.findingsExitCode ?? 1;
  if (observation.exitCode !== cleanExitCode && observation.exitCode !== findingsExitCode) {
    return secretScanReasons.indeterminate(
      "tool-errored",
      `${observation.toolName} exited ${observation.exitCode}, which is neither its clean code (${cleanExitCode}) ` +
        `nor its findings code (${findingsExitCode}). It failed rather than answered.`,
    );
  }

  const hits = Array.isArray(observation.hits) ? observation.hits : undefined;
  if (hits === undefined) {
    return secretScanReasons.indeterminate("inconsistent-report", "The scan record carries no hit list at all.");
  }
  if (observation.exitCode === findingsExitCode && hits.length === 0) {
    return secretScanReasons.indeterminate(
      "inconsistent-report",
      `${observation.toolName} signalled findings but reported none. The record contradicts itself, so neither half ` +
        "of it can be believed.",
    );
  }
  if (observation.exitCode === cleanExitCode && hits.length > 0) {
    return secretScanReasons.indeterminate(
      "inconsistent-report",
      `${observation.toolName} signalled a clean run but reported ${hits.length} hit(s). The record contradicts ` +
        "itself, so neither half of it can be believed.",
    );
  }

  if (hits.length > 0) {
    return gateViolated(
      hits.map((hit) => {
        const ruleId = typeof hit.ruleId === "string" && hit.ruleId !== "" ? hit.ruleId : "unnamed-rule";
        return {
          rule: "secret-detected" as const,
          severity: "error" as const,
          path: typeof hit.path === "string" && hit.path !== "" ? hit.path : "<unreported path>",
          message:
            `${observation.toolName} rule ${ruleId}` +
            (hit.commit === undefined ? "" : ` in commit ${hit.commit}`) +
            `: ${hit.description ?? "a credential-shaped string was reported at this location"}`,
        };
      }),
    );
  }

  // Only now, with a completed, self-consistent, empty-handed run in hand, is
  // coverage the remaining question. A run that examined nothing is not clean.
  if (observation.scope === undefined) {
    return secretScanReasons.indeterminate(
      "scope-undeclared",
      "The scan record does not say what it covered, so 'nothing found' has no stated extent.",
    );
  }
  if (typeof observation.unitsScanned !== "number" || !Number.isSafeInteger(observation.unitsScanned) || observation.unitsScanned <= 0) {
    return secretScanReasons.indeterminate(
      "empty-scan-scope",
      `${observation.toolName} reported a clean ${observation.scope} run over ${JSON.stringify(observation.unitsScanned)} ` +
        "units. Zero coverage reads exactly like a clean result and means nothing like one.",
    );
  }

  return gateSatisfied(observation.unitsScanned);
}
