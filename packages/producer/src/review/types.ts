/** Shared shapes of `clossys review` (docs/review.md (not shipped) is generated from the constants that use them). */

export type Level = "fail" | "note";

/** One line of the findings list: fail-level findings make the verdict FAIL; notes are reported only. */
export interface Finding { readonly id: string; readonly level: Level; readonly subject: string; readonly detail: string }

export type StepStatus = "pass" | "fail" | "skip";

/** One mechanical step and what it ran. */
export interface StepResult { readonly step: string; readonly status: StepStatus; readonly detail: string; readonly ms: number }

export interface MutantResult {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly operator: string;
  readonly from: string;
  readonly to: string;
  /** killed: a covering test failed; survived: every covering test passed; invalid: the mutant did not compile; uncovered: no covering test. */
  readonly status: "killed" | "survived" | "invalid" | "uncovered";
  readonly by?: string;
}

export interface ReviewReport {
  readonly schema: "clossys.review/1";
  readonly base: string;
  readonly head: string;
  readonly tree: string;
  readonly changed: { readonly files: readonly string[]; readonly packages: readonly string[] };
  readonly steps: readonly StepResult[];
  readonly counts: Readonly<Record<string, { readonly base: number | null; readonly head: number | null }>>;
  readonly mutants: readonly MutantResult[];
  readonly findings: readonly Finding[];
  /** Every command the review ran (git plumbing aside), and those that exited 127 (not installed, not found). */
  readonly ran: { readonly commands: number; readonly missing: readonly string[] };
  /** Red tests (`file` or `file :: full test name`) that do not also fail alone at the merge base: these fail. */
  readonly newRed: readonly string[];
  /** Red tests that also fail alone at the merge base (or that the --fast record lists base-red): reported only. */
  readonly baseRed: readonly string[];
  readonly verdict: "PASS" | "FAIL";
  /** The last printed line: `MECHANICAL: <verdict> <head-sha> <tree-sha>`. */
  readonly line: string;
  /** Set only on a record `clossys review --import` wrote: the cloud gate result it came from (review/cloud.ts). */
  readonly imported?: {
    readonly ref: string; readonly commit: string | null; readonly unit: string; readonly gateVerdict: "PASS" | "FAIL";
    readonly head: string; readonly tree: string; readonly base: string; readonly mergeBase: string;
  };
}
