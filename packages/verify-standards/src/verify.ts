/**
 * The orchestrator: run the staleness floor and the selected checks, fold
 * the results, and produce one verdict.
 *
 * Two properties of the fold are load-bearing, and both are inherited from
 * `foldGateResults` rather than re-derived here:
 *
 * 1. **`indeterminate` dominates.** One check that could not evaluate makes
 *    the whole run's answer "could not evaluate", regardless of how many
 *    others were clean. The alternative — reporting a failure as a pass
 *    because most of the run was fine — is the defect this package exists to
 *    make impossible.
 * 2. **Nothing selected is not a pass.** An empty run folds to
 *    `indeterminate`, never `satisfied`. A consumer who narrows the check
 *    selection to nothing gets a loud `2`, not a green tick for a run that
 *    examined nothing.
 *
 * Every check runs; none can prevent another from running, because none of
 * them can throw a value the others would have to catch — they are pure
 * functions over data that was already read. That is the same "never fail
 * fast, always report all four" property a shell-based gate has to build by
 * hand out of `continue-on-error`, obtained here for free by not doing I/O.
 */

import { createGateReasons, foldGateResults, gateResultToExitCode } from "@vespeneventures/governance/gates";
import type { GateResult } from "@vespeneventures/governance/gates";
import { checkPolicyDrift } from "./policy-drift.js";
import type { PolicyDriftObservation, PolicyDriftOptions } from "./policy-drift.js";
import { checkReviewEvidence } from "./review-evidence.js";
import type { ReviewEvidenceOptions } from "./review-evidence.js";
import { checkSecretScan } from "./secret-scan.js";
import type { SecretScanObservation, SecretScanPolicy } from "./secret-scan.js";
import { checkTaskRecord } from "./task-record.js";
import type { TaskRecordObservation, TaskRecordPolicy } from "./task-record.js";
import { isRecord } from "./shape.js";
import { STANDARDS_CHECKS } from "./types.js";
import type { CheckFinding, StandardsCheckName, StandardsFinding, StandardsReportRow } from "./types.js";
import { checkVersionFloor } from "./version.js";

/** The schema version of the inputs document this package accepts. */
export const VERIFY_STANDARDS_INPUTS_VERSION = 1 as const;

/** Every reason the inputs document itself can be unreadable. */
export const inputsReasons = createGateReasons([
  "no-inputs-supplied",
  "unsupported-inputs-schema-version",
] as const);

/** Every reason the check selection itself can make a run meaningless. */
export const selectionReasons = createGateReasons(["no-checks-selected"] as const);

/**
 * Everything the four checks read, as one caller-assembled document.
 *
 * Every section is optional, and an omitted section is `indeterminate` for
 * its check rather than a skip. That is the deliberate direction: a consumer
 * that forgets to wire an input gets a failing run explaining exactly which
 * input is missing, never a green run that quietly checked three things.
 */
export interface VerifyStandardsInputs {
  readonly schemaVersion: typeof VERIFY_STANDARDS_INPUTS_VERSION;
  readonly secretScan?: {
    readonly observation?: SecretScanObservation;
    readonly policy?: SecretScanPolicy;
  };
  readonly taskRecord?: {
    readonly observation?: TaskRecordObservation;
    readonly policy?: TaskRecordPolicy;
  };
  readonly reviewEvidence?: {
    readonly evidence?: unknown;
    readonly policy?: unknown;
    readonly options?: ReviewEvidenceOptions;
  };
  readonly policyDrift?: {
    readonly observation?: PolicyDriftObservation;
    readonly options?: PolicyDriftOptions;
  };
}

/** How the run itself is configured, separately from what it reads. */
export interface VerifyStandardsOptions {
  /** Which of the four checks to run. Selecting none folds to `indeterminate`. */
  readonly selectedChecks: readonly StandardsCheckName[];
  /** This build's own version, as resolved by whatever loaded it. */
  readonly installedVersion: string | undefined;
  /** A floor higher than the compiled one. Never lowers it. */
  readonly minimumVersion?: string;
  /** The range the caller declared for this package in its own manifest. */
  readonly declaredRange?: string;
}

/** One row of the report. */
export interface StandardsRowReport {
  readonly row: StandardsReportRow;
  readonly result: GateResult<StandardsFinding, string>;
  /** A short, human-facing note that survives into the rendered report. */
  readonly note?: string;
}

/** The whole run. */
export interface VerifyStandardsReport {
  readonly rows: readonly StandardsRowReport[];
  readonly overall: GateResult<StandardsFinding, string>;
  /** `0` satisfied, `1` violated, `2` indeterminate. Nothing can override this mapping. */
  readonly exitCode: 0 | 1 | 2;
}

/** Names what a non-object inputs document actually was, for the row that reports it. */
function describeNonObject(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/** Attaches the producing row to a check's own findings, leaving everything else untouched. */
function attribute<TFinding extends CheckFinding, TReason extends string>(
  row: StandardsReportRow,
  result: GateResult<TFinding, TReason>,
): GateResult<StandardsFinding, string> {
  if (result.verdict !== "violated") return result;
  return {
    verdict: "violated",
    findings: result.findings.map((item) => ({
      row,
      rule: item.rule,
      severity: item.severity,
      path: item.path,
      message: item.message,
    })),
  };
}

/** Runs the floor and the selected checks. Never throws for a data problem; every one is a verdict. */
export function verifyStandards(
  inputs: VerifyStandardsInputs | undefined,
  options: VerifyStandardsOptions,
): VerifyStandardsReport {
  const rows: StandardsRowReport[] = [];

  const floor = checkVersionFloor({
    installedVersion: options.installedVersion,
    minimumVersion: options.minimumVersion,
    declaredRange: options.declaredRange,
  });
  rows.push({
    row: "version-floor",
    result: attribute("version-floor", floor.result),
    note:
      `minimum safe version ${floor.effectiveMinimumVersion}` +
      (floor.callerFloorIgnored ? " (a lower caller-supplied floor was ignored)" : ""),
  });

  // The inputs document gets its own row whenever there is something wrong
  // with it. Without one, a caller who passed a document this build cannot
  // read would see four identical "no observation supplied" rows and no
  // statement of the actual cause.
  // `inputs` is declared as a type, and arrives as `JSON.parse` output. A
  // document that is `null`, a number, a string, or an array satisfies no
  // part of that declaration and is checked for here rather than trusted:
  // reading `.schemaVersion` off `null` throws, and a throw at this layer
  // leaves the process on Node's uncaught-exception status of `1`, which
  // this package's contract reads as "violated". A document that is not an
  // object is the same situation as no document at all — nothing was
  // supplied that any check could read — so it takes the same row.
  const supplied: unknown = inputs;
  const documentSupplied = isRecord(supplied);
  const readable =
    documentSupplied && (supplied as { schemaVersion?: unknown }).schemaVersion === VERIFY_STANDARDS_INPUTS_VERSION;
  if (!readable) {
    rows.push({
      row: "inputs",
      result: inputsReasons.indeterminate(
        documentSupplied ? "unsupported-inputs-schema-version" : "no-inputs-supplied",
        documentSupplied
          ? `The inputs document declares schemaVersion ${JSON.stringify((supplied as { schemaVersion?: unknown }).schemaVersion)} ` +
            `and this build reads ${VERIFY_STANDARDS_INPUTS_VERSION}. Reading it under the wrong schema would be guessing.`
          : supplied === undefined
            ? "No inputs document was supplied, so no check had anything to read."
            : `The inputs document is ${describeNonObject(supplied)} rather than an object, so it is not a document ` +
              "this build can read any section out of.",
      ),
    });
  }

  // An empty selection needs its own row, and this is not a formality. The
  // floor row is present in every run and is ordinarily `satisfied`, so a run
  // that selected no checks at all would otherwise fold to one satisfied
  // result and exit 0 — a green tick for a run that inspected nothing, which
  // is the precise defect this package exists to make unreachable.
  const selected = new Set(options.selectedChecks);
  if (selected.size === 0) {
    rows.push({
      row: "check-selection",
      result: selectionReasons.indeterminate(
        "no-checks-selected",
        `No check was selected, so nothing about the repository was examined. Known checks: ${STANDARDS_CHECKS.join(", ")}.`,
      ),
    });
  }
  for (const check of STANDARDS_CHECKS) {
    if (!selected.has(check)) continue;
    rows.push(runCheck(check, readable ? inputs : undefined));
  }

  const overall = foldGateResults(
    rows.map((row) => row.result),
    {
      emptyReason: "no-rows-evaluated",
      emptyDetail: "No check produced a result, which is not the same thing as every check passing.",
    },
  );

  return { rows, overall, exitCode: gateResultToExitCode(overall) };
}

function runCheck(check: StandardsCheckName, inputs: VerifyStandardsInputs | undefined): StandardsRowReport {
  switch (check) {
    case "secret-scan": {
      const section = inputs?.secretScan;
      return { row: check, result: attribute(check, checkSecretScan(section?.observation, section?.policy)) };
    }
    case "task-record": {
      const section = inputs?.taskRecord;
      const report = checkTaskRecord(section?.observation, section?.policy);
      const note =
        report.exemption !== undefined
          ? `structurally exempt by ${report.exemption.kind} ${JSON.stringify(report.exemption.matched)}`
          : report.reference === undefined
            ? undefined
            : `work item ${report.reference.scope}#${report.reference.number}`;
      return { row: check, result: attribute(check, report.result), ...(note === undefined ? {} : { note }) };
    }
    case "review-evidence": {
      // Absent, null, and structurally wrong options are all decided inside
      // the check itself rather than pre-screened here. `requireReviewPresence`
      // is a required boolean with no default, so an options object this
      // package cannot read is a missing input rather than an implied setting
      // — and the check is the public boundary a direct caller reaches too,
      // so that judgement has to live there to be worth anything.
      const section = inputs?.reviewEvidence;
      const report = checkReviewEvidence(section?.evidence, section?.policy, section?.options);
      const note =
        report.providersObserved.length === 0
          ? undefined
          : `providers observed: ${report.providersObserved.join(", ")}`;
      return { row: check, result: attribute(check, report.result), ...(note === undefined ? {} : { note }) };
    }
    case "policy-drift": {
      // Same delegation as review-evidence directly above, for the same
      // reason: `allowUndeclaredLiveRequirements` has no default either.
      const section = inputs?.policyDrift;
      const report = checkPolicyDrift(section?.observation, section?.options);
      return {
        row: check,
        result: attribute(check, report.result),
        ...(report.compared === 0 ? {} : { note: `${report.compared} requirement(s) compared` }),
      };
    }
    default: {
      const unhandled: never = check;
      throw new Error(`verifyStandards: unknown check ${JSON.stringify(unhandled)}`);
    }
  }
}
