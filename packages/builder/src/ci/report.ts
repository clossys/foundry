/**
 * The shared half of #257: folding several subjects' `liveStateSurface`
 * reconciliation reports into one verdict, and mapping that verdict onto
 * this repository's 0/1/2 exit-code contract.
 *
 * This is deliberately generic over WHAT is being reconciled. `./toolchain-cli.ts`
 * is the first concrete consumer — a runtime pin, a package-manager pin, and
 * a build order — but nothing here reads a toolchain, a manifest, or a
 * deployment surface. A future gate over any other `LiveStateSubjectReport`
 * producer (a manifest's `verifyInstallation`, a deployment surface's health
 * check, or a subject this package has not shipped yet) reuses this same
 * function rather than re-deriving its own fold.
 */

import { foldGateResults, gateResultToExitCode } from "@vespeneventures/controller/gates";
import type { GateResult } from "@vespeneventures/controller/gates";
import type {
  LiveStateFinding,
  LiveStateReconciliationReason,
  LiveStateSubjectReport,
} from "../live-state.js";

/** One row of a multi-subject reconciliation report. */
export interface LiveStateReportRow {
  readonly subject: string;
  readonly result: GateResult<LiveStateFinding, LiveStateReconciliationReason | "no-subjects-reconciled">;
}

/** The whole run: every subject reconciled, and the fold-closed overall verdict. */
export interface LiveStateGateReport {
  readonly rows: readonly LiveStateReportRow[];
  readonly overall: GateResult<LiveStateFinding, LiveStateReconciliationReason | "no-subjects-reconciled">;
  /** `0` verified, `1` drifted, `2` could-not-verify. Nothing overrides this mapping — see `gateResultToExitCode`. */
  readonly exitCode: 0 | 1 | 2;
}

/**
 * Folds any number of subject reports into one `LiveStateGateReport`.
 *
 * An empty `reports` list folds to `could-not-verify`, never to `verified` —
 * the same "nothing selected is not a pass" discipline `verify-standards`'s
 * own orchestrator applies to an empty check selection. A run that
 * reconciled zero subjects examined nothing, and a green tick for that is
 * exactly the defect #256 and #257 both exist to make impossible.
 */
export function foldLiveStateReports(reports: readonly LiveStateSubjectReport[]): LiveStateGateReport {
  const rows: LiveStateReportRow[] = reports.map((report) => ({ subject: report.subject, result: report.result }));
  const overall = foldGateResults(
    rows.map((row) => row.result),
    {
      emptyReason: "no-subjects-reconciled",
      emptyDetail: "No subject was reconciled, which is not the same thing as every subject agreeing.",
    },
  );
  return { rows, overall, exitCode: gateResultToExitCode(overall) };
}
