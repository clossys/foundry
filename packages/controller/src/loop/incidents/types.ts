/**
 * The incident loop's shapes (CP1-HEAL): detect -> match -> heal -> guard -> report.
 *
 * An incident record is the one fixed form every failing verb or check writes. A known cause is
 * data (causes.json): a matcher over the record's stage and signature, the owner agent, a named
 * remedy that fixes it with no model (or `none`), and a guard: a rule in the repository's rule
 * registry whose check fails on that cause's violation fixture.
 */

export const INCIDENT_SCHEMA = "foundry.incident/1" as const;
export const OUTCOME_SCHEMA = "foundry.incident-outcome/1" as const;
export const CAUSES_SCHEMA = "foundry.incident-causes/1" as const;

/** One failure, in the fixed form: which stage, which command, its exit code, and its normalized signature. */
export interface IncidentRecord {
  readonly schema: typeof INCIDENT_SCHEMA;
  readonly stage: string;
  readonly command: string;
  readonly exit: number;
  /** Stable text: the failing output with paths, shas, times and numbers removed (signature.ts). */
  readonly signature: string;
  /** When the failure happened (ISO 8601). The report windows and the repeat rule read it. */
  readonly at: string;
}

/** A known cause. `remedy` names a function in remedies.ts, or is `none`; `guard` names a registry rule id. */
export interface KnownCause {
  readonly id: string;
  /** A multiline regular expression over `<stage>\n<signature>`. */
  readonly match: string;
  /** The agent package that owns the cause: it is told when the cause has no remedy. */
  readonly owner: string;
  readonly remedy: string;
  /** What blocks the step when there is no remedy, or when the remedy did not heal it. */
  readonly blocker: string;
  /** A rule id in the repository's rule registry (scripts/rules/registry.json, in the repository; it does not ship); check:heal refuses a cause without one. */
  readonly guard?: string;
  /** When the guard landed (ISO 8601). A record after it is a repeat. */
  readonly guard_landed?: string;
  readonly note?: string;
}

export interface CausesDocument {
  readonly schema: typeof CAUSES_SCHEMA;
  readonly causes: readonly KnownCause[];
}

/** What one command run returned. */
export interface RunResult {
  readonly exit: number;
  readonly output: string;
}

export type HealOutcome = "healed" | "still-failing" | "blocked" | "new-cause";

/** The written result of one heal: the record it judged, the cause, and what the re-run did. */
export interface HealOutcomeRecord {
  readonly schema: typeof OUTCOME_SCHEMA;
  readonly signature: string;
  readonly stage: string;
  readonly command: string;
  readonly cause: string | null;
  readonly outcome: HealOutcome;
  readonly remedy: string | null;
  readonly rerun_exit: number | null;
  readonly base_exit: number | null;
  readonly at: string;
}
