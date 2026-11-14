/**
 * The criteria contract (R15.3, slot-constitution.md sections 5a and 5b). A criterion is one
 * parameterised mechanical check a standard lists as a requirement: a pure function of the subject
 * (one candidate's text and parse) and the requirement's params, returning one message per failure.
 * It never reads files, the clock, the network or randomness, and never sees a recipe (R16.1).
 */

/** What a criterion judges: one candidate. */
export interface Subject {
  /** The slot kind, or `<kind>/<contract.kind>` when the contract names one. */
  readonly kind: string;
  /** The candidate text (a Markdown candidate's body, without its frontmatter). */
  readonly text: string;
  /** The parsed JSON of a `.json` candidate, or a Markdown candidate's frontmatter fields. */
  readonly json?: unknown;
}

export type Params = Readonly<Record<string, unknown>>;

/** One criterion: the failures of the subject under the params; [] passes. */
export type Criterion = (subject: Subject, params: Params) => string[];

/** One `index.json` row: a criterion id, the module (no extension) and export that implements it, and its fixture file. */
export interface CriterionEntry {
  readonly id: string;
  readonly module: string;
  readonly export: string;
  /** Fixture file (relative to the index folder): `{pass: Case[], fail: Case[]}`. */
  readonly fixtures: string;
  readonly summary: string;
}

/** One fixture case. */
export interface CriterionCase { readonly subject: Subject; readonly params?: Params; readonly note?: string }
