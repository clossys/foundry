/**
 * The shapes every check in this package shares.
 *
 * Deliberately just types and one small constant list — no logic. The
 * per-check observation shapes live beside the checks that consume them,
 * because each is meaningful only to its own evaluator; what belongs here is
 * the vocabulary the *orchestrator* needs in order to treat four unrelated
 * checks uniformly.
 */

/** The four checks this package bundles, in the fixed order they are reported. */
export const STANDARDS_CHECKS = Object.freeze([
  "secret-scan",
  "task-record",
  "review-evidence",
  "policy-drift",
] as const);

/** One of the four bundled checks. */
export type StandardsCheckName = (typeof STANDARDS_CHECKS)[number];

/**
 * One reportable problem, in the one shape every check emits.
 *
 * A single shape across four unrelated checks is what lets the orchestrator
 * fold them together without knowing what any of them does, and what lets a
 * consumer's CI render one table instead of four. `severity` is a
 * single-member union rather than the `"error" | "warning"` some sibling
 * packages use: a warning that does not change the verdict is indistinguish-
 * able, at the exit-code boundary, from no finding at all, and this package's
 * entire purpose is to refuse results that are indistinguishable from
 * nothing.
 */
export interface CheckFinding {
  /** Stable identifier for the rule that produced this finding. */
  readonly rule: string;
  readonly severity: "error";
  /** The field, path, or subject this finding is about. */
  readonly path: string;
  readonly message: string;
}

/**
 * Every row a report can carry: the four checks, plus three rows that are
 * about the run rather than about the repository — the staleness floor, the
 * caller's inputs document, and the check selection itself. None of the three
 * says anything about the repository under inspection, but each produces a
 * verdict on the same ternary and is folded in with the rest, so each needs a
 * name in the same vocabulary.
 */
export type StandardsReportRow = StandardsCheckName | "version-floor" | "inputs" | "check-selection";

/** A `CheckFinding` with the row that produced it attached. What the report carries. */
export interface StandardsFinding extends CheckFinding {
  readonly row: StandardsReportRow;
}
