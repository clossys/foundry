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
  readonly verdict: "PASS" | "FAIL";
}
